#!/usr/bin/env node
/**
 * Clonador local com Playwright — 100% offline após a captura.
 * Não envia dados a terceiros; só fala com a URL que você passar.
 *
 * Uso:
 *   npm run clone -- https://exemplo.com
 *   npm run clone -- https://exemplo.com --depth 2 --out ./output/meusite
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const MAX_DEPTH = 5;
const MAX_PAGES_HARD = 100;
const MAX_ASSET_BYTES = 25 * 1024 * 1024; // 25 MiB por asset

function parseArgs(argv) {
  const args = { url: null, depth: 1, out: null, maxPages: 30, waitMs: 1500 };
  const rest = [...argv];
  while (rest.length) {
    const t = rest.shift();
    if (t === "--depth") args.depth = Number(rest.shift());
    else if (t === "--out") args.out = rest.shift();
    else if (t === "--max-pages") args.maxPages = Number(rest.shift());
    else if (t === "--wait") args.waitMs = Number(rest.shift());
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
    rawPath === "/"
      ? "index.html"
      : sanitizePathSegments(rawPath);
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

function rewriteHtml(html, pageUrl, urlToLocal) {
  const base = new URL(pageUrl);
  return html.replace(
    /(href|src|action)=["']([^"']+)["']/gi,
    (match, attr, raw) => {
      try {
        if (
          /^(data:|mailto:|tel:|javascript:|#)/i.test(raw)
        ) {
          return match;
        }
        const abs = new URL(raw, base).href;
        const local = urlToLocal.get(abs);
        if (!local) return match;
        return `${attr}="${local}"`;
      } catch {
        return match;
      }
    }
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.url) {
    console.log(
      "Uso: npm run clone -- <url> [--depth N] [--out DIR] [--max-pages N] [--wait MS]"
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
      "Mozilla/5.0 (compatible; SiteCloner/1.0; +local-offline-archive)",
    viewport: { width: 1440, height: 900 },
    // Bloqueia downloads de arquivo e popups
    acceptDownloads: false,
    javaScriptEnabled: true,
  });

  const savedAssets = new Map();
  const pageQueue = [{ url: start.href, depth: 0 }];
  const seenPages = new Set();
  const pageFiles = new Map();
  const pendingAssetWrites = new Set();

  console.log(`→ URL:    ${start.href}`);
  console.log(`→ Saída:  ${outDir}`);
  console.log(`→ Depth:  ${args.depth} | max pages: ${args.maxPages}`);
  console.log("→ Rede:   só o site alvo + CDNs que ele carregar (local)");

  while (pageQueue.length && seenPages.size < args.maxPages) {
    const { url, depth } = pageQueue.shift();
    if (seenPages.has(url)) continue;
    seenPages.add(url);

    const page = await context.newPage();
    page.on("response", (response) => {
      const task = (async () => {
        try {
          const req = response.request();
          if (req.resourceType() === "document") return;
          const status = response.status();
          if (status < 200 || status >= 400) return;
          const resUrl = response.url();
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
          if (!body || !body.length || body.length > MAX_ASSET_BYTES) return;

          const rel = assetRelPath(u);
          const absFile = ensureInside(outDir, rel);
          await mkdir(path.dirname(absFile), { recursive: true });
          await writeFile(absFile, body);
          savedAssets.set(resUrl, rel);
        } catch {
          /* asset race / abort */
        }
      })();
      pendingAssetWrites.add(task);
      task.finally(() => pendingAssetWrites.delete(task));
    });

    console.log(`  [${seenPages.size}] depth=${depth} ${url}`);
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    } catch (err) {
      console.warn(`  ! falhou: ${err.message}`);
      await page.close();
      continue;
    }
    await sleep(args.waitMs);
    await Promise.allSettled([...pendingAssetWrites]);

    const html = await page.content();
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

  const urlToLocal = new Map([...savedAssets, ...pageFiles]);
  for (const [pageUrl, rel] of pageFiles) {
    const file = ensureInside(outDir, rel);
    let html = await readFile(file, "utf8");
    const dir = path.posix.dirname(rel);
    const localized = new Map();
    for (const [abs, target] of urlToLocal) {
      let relPath = path.posix.relative(dir === "." ? "" : dir, target);
      if (!relPath.startsWith(".") && !relPath.startsWith("/")) {
        relPath = `./${relPath}`;
      }
      localized.set(abs, relPath);
    }
    html = rewriteHtml(html, pageUrl, localized);
    await writeFile(file, html, "utf8");
  }

  const manifest = {
    tool: "site-cloner",
    version: "1.1.0",
    source: start.href,
    capturedAt: new Date().toISOString(),
    localOnly: true,
    pages: [...pageFiles.entries()].map(([url, file]) => ({ url, file })),
    assets: savedAssets.size,
  };
  await writeFile(
    ensureInside(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );

  await browser.close();
  console.log(
    `Pronto: ${pageFiles.size} páginas, ${savedAssets.size} assets → ${outDir}`
  );
  console.log(
    `Abra: ${path.join(outDir, pageFiles.get(start.href) || "index.html")}`
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
