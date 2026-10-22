#!/usr/bin/env node
/**
 * Clonador local com Playwright — 100% offline após a captura.
 * Não envia dados a terceiros; só fala com a URL que você passar.
 *
 * Uso:
 *   npm run clone -- https://exemplo.com
 *   npm run clone -- https://exemplo.com --depth 2 --out ./output/meusite
 *   npm run serve -- ./output/meusite
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const MAX_DEPTH = 5;
const MAX_PAGES_HARD = 100;
const MAX_ASSET_BYTES = 25 * 1024 * 1024; // 25 MiB por asset
const VERSION = "1.2.0";

/** Assets servidos na raiz — manter path absoluto para o `serve` mapear. */
const ROOT_ASSET_RE =
  /^\/(?:_next|media|brand|favicon\.ico|icon[^/]*|apple-touch-icon[^/]*|manifest\.webmanifest|robots\.txt|sitemap\.xml)(?:\/|$)/i;

function parseArgs(argv) {
  const args = {
    url: null,
    depth: 1,
    out: null,
    maxPages: 30,
    waitMs: 2000,
    scroll: true,
  };
  const rest = [...argv];
  while (rest.length) {
    const t = rest.shift();
    if (t === "--depth") args.depth = Number(rest.shift());
    else if (t === "--out") args.out = rest.shift();
    else if (t === "--max-pages") args.maxPages = Number(rest.shift());
    else if (t === "--wait") args.waitMs = Number(rest.shift());
    else if (t === "--no-scroll") args.scroll = false;
    else if (t === "--help" || t === "-h") args.help = true;
    else if (!t.startsWith("-") && !args.url) args.url = t;
  }
  return args;
}

function hostKey(hostname) {
  return String(hostname)
    .replace(/^www\./i, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "_");
}

/** Remove "..", null bytes e absolutos; só segmentos seguros. */
function sanitizePathSegments(pathname) {
  const parts = String(pathname || "/")
    .split("/")
    .map((s) => s.replace(/\0/g, ""))
    .filter((s) => s && s !== "." && s !== "..")
    .map((s) => s.replace(/[^a-zA-Z0-9._~%-]/g, "_").slice(0, 180));
  return parts.join("/") || "index";
}

function ensureInside(outDir, rel) {
  const resolvedOut = path.resolve(outDir);
  const abs = path.resolve(resolvedOut, rel);
  const relToOut = path.relative(resolvedOut, abs);
  if (relToOut.startsWith("..") || path.isAbsolute(relToOut)) {
    throw new Error(`path escape bloqueado: ${rel}`);
  }
  return abs;
}

function pageRelPath(urlObj, baseHost) {
  const host = hostKey(urlObj.hostname);
  const rawPath = urlObj.pathname || "/";
  let p =
    rawPath === "/" ? "index.html" : sanitizePathSegments(rawPath);
  if (p !== "index.html" && !path.posix.extname(p)) {
    p = `${p}/index.html`;
  }
  const qs = urlObj.search
    ? createHash("sha256").update(urlObj.search).digest("hex").slice(0, 10)
    : "";
  if (qs) {
    const ext = path.posix.extname(p) || ".html";
    p = `${p.slice(0, -ext.length)}__q${qs}${ext}`;
  }
  if (host === hostKey(baseHost)) return p;
  return path.posix.join("_assets", host, p);
}

function assetRelPath(urlObj) {
  const host = hostKey(urlObj.hostname);
  let p = sanitizePathSegments(urlObj.pathname) || "asset.bin";
  if (!path.posix.extname(p)) p = `${p}.bin`;
  const qs = urlObj.search
    ? createHash("sha256").update(urlObj.search).digest("hex").slice(0, 10)
    : "";
  if (qs) {
    const ext = path.posix.extname(p);
    p = `${p.slice(0, -ext.length)}__q${qs}${ext}`;
  }
  return path.posix.join("_assets", host, p);
}

function sameSite(a, b) {
  return hostKey(a) === hostKey(b);
}

function assertHttpUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`URL inválida: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Só http(s) permitido (recebido ${u.protocol})`);
  }
  if (!u.hostname) throw new Error("URL sem hostname");
  return u;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Extrai URLs de assets do HTML (src, href estático, srcset, url()). */
function harvestAssetUrls(html, pageUrl) {
  const base = new URL(pageUrl);
  const found = new Set();

  const add = (raw) => {
    if (!raw || /^(data:|mailto:|tel:|javascript:|#)/i.test(raw)) return;
    try {
      const u = new URL(raw.trim(), base);
      if (u.protocol !== "http:" && u.protocol !== "https:") return;
      u.hash = "";
      found.add(u.href);
    } catch {
      /* skip */
    }
  };

  for (const m of html.matchAll(
    /\b(?:src|href|poster|data-src|data-background(?:-image)?)=["']([^"']+)["']/gi
  )) {
    add(m[1]);
  }

  for (const m of html.matchAll(/\bsrcset=["']([^"']+)["']/gi)) {
    for (const part of m[1].split(",")) {
      const url = part.trim().split(/\s+/)[0];
      if (url) add(url);
    }
  }

  for (const m of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    add(m[1]);
  }

  // Só assets (não páginas HTML)
  return [...found].filter((href) => {
    try {
      const u = new URL(href);
      const ext = path.posix.extname(u.pathname).toLowerCase();
      if (
        [
          ".css",
          ".js",
          ".mjs",
          ".map",
          ".png",
          ".jpg",
          ".jpeg",
          ".webp",
          ".avif",
          ".gif",
          ".svg",
          ".ico",
          ".woff",
          ".woff2",
          ".ttf",
          ".otf",
          ".mp4",
          ".webm",
          ".json",
          ".webmanifest",
        ].includes(ext)
      ) {
        return true;
      }
      return ROOT_ASSET_RE.test(u.pathname);
    } catch {
      return false;
    }
  });
}

/**
 * Mantém /_next, /media, /brand absolutos (serve + hidratação Next).
 * Só reescreve <a href> / action de páginas — nunca toca em <script> RSC.
 */
function rewriteHtml(html, pageUrl, pageUrlToLocal) {
  const base = new URL(pageUrl);

  const mapPageHref = (raw) => {
    if (/^(data:|mailto:|tel:|javascript:|#|https?:\/\/wa\.me)/i.test(raw)) {
      return null;
    }
    let abs;
    try {
      abs = new URL(raw, base);
    } catch {
      return null;
    }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return null;
    if (ROOT_ASSET_RE.test(abs.pathname)) return null;
    const key = abs.origin + abs.pathname + abs.search;
    const local = pageUrlToLocal.get(key) || pageUrlToLocal.get(abs.href);
    return local || null;
  };

  // Reescreve só atributos href/action fora de <script>…</script>
  const parts = html.split(/(<script\b[^>]*>[\s\S]*?<\/script>)/gi);
  for (let i = 0; i < parts.length; i++) {
    if (/^<script\b/i.test(parts[i])) continue;
    parts[i] = parts[i].replace(
      /(href|action)=["']([^"']+)["']/gi,
      (match, attr, raw) => {
        const local = mapPageHref(raw);
        if (!local) return match;
        return `${attr}="${local}"`;
      }
    );
  }
  return parts.join("");
}

/** Repara escapes RSC se algum passo anterior quebrou \" após .js */
function repairRscEscapes(html) {
  return html.replace(
    /(\/_next\/static\/[^"\\]+?\.(?:js|css))"(\])/g,
    '$1\\"$2'
  );
}

async function dismissIntro(page) {
  const selectors = [
    'button:has-text("Pular introdução")',
    'button:has-text("PULAR INTRODUÇÃO")',
    'a:has-text("Pular introdução")',
    'button.Hero-module__7HnD1W__skip',
    '[data-skip-intro]',
    'button:has-text("Skip")',
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1200 })) {
        await el.click({ timeout: 2000 });
        await sleep(900);
        return true;
      }
    } catch {
      /* next */
    }
  }
  // Marca intro como vista sem depender do botão (sites Kyrios/vdkids)
  try {
    await page.evaluate(() => {
      try {
        sessionStorage.setItem("k-intro", "1");
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* ignore */
  }
  return false;
}

/** Espera o hero/poster ficar visível após a intro. */
async function waitForHero(page) {
  try {
    await page.waitForFunction(
      () => {
        const hero = document.querySelector(
          '[class*="Hero-module"][class*="hero"], [class*="__hero"]'
        );
        if (!hero) return true;
        const img = hero.querySelector("img, canvas, video, picture img");
        if (!img) return true;
        const st = getComputedStyle(hero);
        return st.opacity !== "0" && st.visibility !== "hidden";
      },
      { timeout: 8000 }
    );
  } catch {
    /* segue mesmo assim */
  }
}

async function scrollPage(page) {
  await page.evaluate(async () => {
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    const height = Math.max(
      document.body?.scrollHeight || 0,
      document.documentElement?.scrollHeight || 0
    );
    const step = Math.max(window.innerHeight * 0.7, 400);
    for (let y = 0; y < height + step; y += step) {
      window.scrollTo(0, y);
      await delay(280);
    }
    window.scrollTo(0, 0);
    await delay(200);
  });
}

async function saveAssetFromBuffer(outDir, savedAssets, resUrl, body) {
  if (!body?.length || body.length > MAX_ASSET_BYTES) return null;
  if (savedAssets.has(resUrl)) return savedAssets.get(resUrl);
  let u;
  try {
    u = new URL(resUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const rel = assetRelPath(u);
  const absFile = ensureInside(outDir, rel);
  if (!(await fileExists(absFile))) {
    await mkdir(path.dirname(absFile), { recursive: true });
    await writeFile(absFile, body);
  }
  savedAssets.set(resUrl, rel);
  return rel;
}

async function downloadUrl(context, outDir, savedAssets, href) {
  if (savedAssets.has(href)) return savedAssets.get(href);
  try {
    const res = await context.request.get(href, { timeout: 30000 });
    if (!res.ok()) return null;
    const body = Buffer.from(await res.body());
    return await saveAssetFromBuffer(outDir, savedAssets, href, body);
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.url) {
    console.log(
      "Uso: npm run clone -- <url> [--depth N] [--out DIR] [--max-pages N] [--wait MS] [--no-scroll]"
    );
    process.exit(args.help ? 0 : 1);
  }

  if (!Number.isFinite(args.depth) || args.depth < 0 || args.depth > MAX_DEPTH) {
    throw new Error(`--depth deve ser 0..${MAX_DEPTH}`);
  }
  if (
    !Number.isFinite(args.maxPages) ||
    args.maxPages < 1 ||
    args.maxPages > MAX_PAGES_HARD
  ) {
    throw new Error(`--max-pages deve ser 1..${MAX_PAGES_HARD}`);
  }
  if (!Number.isFinite(args.waitMs) || args.waitMs < 0 || args.waitMs > 30000) {
    throw new Error("--wait deve ser 0..30000");
  }

  const start = assertHttpUrl(args.url);
  const outDir = path.resolve(
    args.out ||
      path.join(
        ROOT,
        "output",
        `${hostKey(start.hostname)}-${new Date().toISOString().slice(0, 10)}`
      )
  );
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    acceptDownloads: false,
    javaScriptEnabled: true,
    // Animações devem rodar (não reduzir motion)
    reducedMotion: "no-preference",
  });

  const savedAssets = new Map();
  const pageQueue = [{ url: start.href, depth: 0 }];
  const seenPages = new Set();
  const pageFiles = new Map();
  const pendingAssetWrites = new Set();
  const harvestQueue = new Set();

  console.log(`→ URL:    ${start.href}`);
  console.log(`→ Saída:  ${outDir}`);
  console.log(`→ Depth:  ${args.depth} | max pages: ${args.maxPages}`);
  console.log(
    `→ Scroll: ${args.scroll ? "sim" : "não"} | wait: ${args.waitMs}ms`
  );

  while (pageQueue.length && seenPages.size < args.maxPages) {
    const { url, depth } = pageQueue.shift();
    if (seenPages.has(url)) continue;
    seenPages.add(url);

    const page = await context.newPage();
    /** HTML SSR original do document — evita DOM mutado pelo GSAP (quebra hidratação). */
    let ssrHtml = null;

    page.on("response", (response) => {
      const task = (async () => {
        try {
          const req = response.request();
          const resUrl = response.url();
          const status = response.status();
          if (status < 200 || status >= 400) return;

          if (req.resourceType() === "document") {
            // Captura o HTML de rede (pré-JS), não o DOM pós-animação
            const same =
              resUrl === url ||
              resUrl === url.replace(/\/$/, "") ||
              resUrl + "/" === url;
            if (same || new URL(resUrl).pathname === new URL(url).pathname) {
              const text = await response.text().catch(() => null);
              if (text && text.includes("<html")) ssrHtml = text;
            }
            return;
          }

          if (savedAssets.has(resUrl) || resUrl.startsWith("data:")) return;
          let u;
          try {
            u = new URL(resUrl);
          } catch {
            return;
          }
          if (u.protocol !== "http:" && u.protocol !== "https:") return;

          const headers = response.headers();
          const len = Number(headers["content-length"] || 0);
          if (len > MAX_ASSET_BYTES) return;

          const body = await response.body().catch(() => null);
          await saveAssetFromBuffer(outDir, savedAssets, resUrl, body);
        } catch {
          /* asset race / abort */
        }
      })();
      pendingAssetWrites.add(task);
      task.finally(() => pendingAssetWrites.delete(task));
    });

    console.log(`  [${seenPages.size}] depth=${depth} ${url}`);
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
    } catch (err) {
      console.warn(`  ! falhou: ${err.message}`);
      await page.close();
      continue;
    }

    // Interage só para disparar lazy-load de assets (HTML salvo = SSR)
    await dismissIntro(page);
    await waitForHero(page);
    await sleep(args.waitMs);

    if (args.scroll) {
      try {
        await scrollPage(page);
      } catch {
        /* ignore */
      }
      await sleep(400);
    }

    await Promise.allSettled([...pendingAssetWrites]);

    // Fallback: se a resposta document não veio, usa DOM (pior para hidratação)
    let html = ssrHtml;
    if (!html) {
      console.warn("  ! SSR ausente — usando page.content() (pode quebrar animações)");
      html = await page.content();
    }

    for (const assetUrl of harvestAssetUrls(html, url)) {
      harvestQueue.add(assetUrl);
    }
    // Também colhe do DOM (srcset resolvido / lazy)
    try {
      const live = await page.content();
      for (const assetUrl of harvestAssetUrls(live, url)) {
        harvestQueue.add(assetUrl);
      }
    } catch {
      /* ignore */
    }

    const pageRel = pageRelPath(new URL(url), start.hostname);
    pageFiles.set(url, pageRel);

    if (depth < args.depth) {
      const hrefs = await page.$$eval("a[href]", (as) =>
        as.map((a) => a.href).filter(Boolean)
      );
      for (const href of hrefs) {
        try {
          const u = assertHttpUrl(href);
          u.hash = "";
          if (!sameSite(u.hostname, start.hostname)) continue;
          if (ROOT_ASSET_RE.test(u.pathname)) continue;
          if (
            !seenPages.has(u.href) &&
            !pageQueue.some((q) => q.url === u.href)
          ) {
            pageQueue.push({ url: u.href, depth: depth + 1 });
          }
        } catch {
          /* skip */
        }
      }
    }

    const absHtml = ensureInside(outDir, pageRel);
    await mkdir(path.dirname(absHtml), { recursive: true });
    await writeFile(absHtml, html, "utf8");
    await page.close();
  }

  await Promise.allSettled([...pendingAssetWrites]);

  // Baixa assets citados no HTML/srcset que o network idle não capturou
  let harvested = 0;
  for (const href of harvestQueue) {
    if (savedAssets.has(href)) continue;
    const ok = await downloadUrl(context, outDir, savedAssets, href);
    if (ok) harvested++;
  }
  if (harvested) {
    console.log(`→ Harvest: +${harvested} assets do HTML/srcset`);
  }

  // Mapa página → path relativo (para links <a>)
  const pageUrlToLocal = new Map();
  for (const [pageUrl, rel] of pageFiles) {
    const u = new URL(pageUrl);
    const key = u.origin + u.pathname + u.search;
    // Path absoluto de site (/pt-br/...) — o serve resolve; também
    // gravamos relativo a partir da home para file:// parcial.
    pageUrlToLocal.set(key, "/" + rel.replace(/\/index\.html$/, "/").replace(/index\.html$/, ""));
    pageUrlToLocal.set(pageUrl, pageUrlToLocal.get(key));
  }

  for (const [pageUrl, rel] of pageFiles) {
    const file = ensureInside(outDir, rel);
    let html = await readFile(file, "utf8");
    html = repairRscEscapes(html);
    html = rewriteHtml(html, pageUrl, pageUrlToLocal);
    html = repairRscEscapes(html);
    await writeFile(file, html, "utf8");
  }

  // Stub PWA manifest se o site aponta e 404
  const manifestStub = {
    name: hostKey(start.hostname),
    short_name: hostKey(start.hostname),
    start_url: "/",
    display: "standalone",
    background_color: "#111418",
    theme_color: "#111418",
  };
  const manifestRel = assetRelPath(new URL("/manifest.webmanifest", start));
  const manifestAbs = ensureInside(outDir, manifestRel);
  if (!(await fileExists(manifestAbs))) {
    await mkdir(path.dirname(manifestAbs), { recursive: true });
    await writeFile(manifestAbs, JSON.stringify(manifestStub, null, 2));
    savedAssets.set(new URL("/manifest.webmanifest", start).href, manifestRel);
  }

  const captureManifest = {
    tool: "site-cloner",
    version: VERSION,
    source: start.href,
    capturedAt: new Date().toISOString(),
    localOnly: true,
    serveHint: "npm run serve -- " + path.relative(ROOT, outDir),
    pages: [...pageFiles.entries()].map(([url, file]) => ({ url, file })),
    assets: savedAssets.size,
    harvested,
  };
  await writeFile(
    ensureInside(outDir, "manifest.json"),
    JSON.stringify(captureManifest, null, 2)
  );

  await browser.close();
  console.log(
    `Pronto: ${pageFiles.size} páginas, ${savedAssets.size} assets → ${outDir}`
  );
  console.log(`Sirva com: npm run serve -- ${path.relative(ROOT, outDir)}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
