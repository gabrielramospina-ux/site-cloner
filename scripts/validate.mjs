#!/usr/bin/env node
/**
 * Validação local de segurança/integridade do pacote.
 * Rode: npm run validate
 */
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const ok = [];

function fail(msg) {
  errors.push(msg);
}
function pass(msg) {
  ok.push(msg);
}

async function walk(dir, acc = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === "output" || e.name === ".git") {
      continue;
    }
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

// Evita falso positivo em Playwright page.$$eval / $eval
const SUSPICIOUS =
  /(?:(?<!\$)(?<!\$\$)\beval\s*\(|new Function\s*\(|child_process|execSync|spawnSync|WebSocket\s*\(|process\.env\.(?:AWS|GITHUB|TOKEN|SECRET|PASSWORD)|\bcurl\s+|\bwget\s+|powershell|Invoke-WebRequest|exfiltrat)/i;

async function main() {
  const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));

  // 1) Dependências
  const deps = Object.keys(pkg.dependencies || {});
  if (deps.length === 1 && deps[0] === "playwright") {
    pass("Única runtime dependency: playwright");
  } else {
    fail(`Dependências inesperadas: ${deps.join(", ") || "(nenhuma)"}`);
  }

  if (pkg.dependencies?.websnap || pkg.devDependencies?.websnap) {
    fail("Pacote websnap presente — NÃO usar");
  } else {
    pass("Sem websnap no package.json");
  }

  // 2) Scripts de lifecycle
  const life = ["preinstall", "install", "postinstall", "preuninstall", "prepare"];
  for (const s of life) {
    if (pkg.scripts?.[s]) {
      if (s === "postinstall" && /playwright install/.test(pkg.scripts[s])) {
        pass(`postinstall só instala Chromium do Playwright`);
      } else {
        fail(`Script de lifecycle suspeito: ${s}=${pkg.scripts[s]}`);
      }
    }
  }
  if (!pkg.scripts?.postinstall) {
    pass("Sem postinstall automático (Chromium via npm run install:browser)");
  }

  // 3) Arquivos do projeto
  const files = await walk(ROOT);
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    if (!/\.(mjs|js|sh|json|md)$/i.test(rel)) continue;
    const text = await readFile(f, "utf8");
    if (SUSPICIOUS.test(text) && !rel.endsWith("validate.mjs")) {
      fail(`Padrão suspeito em ${rel}`);
    }
  }
  pass(`Scan de ${files.length} arquivos do projeto`);

  // 4) clone.mjs tem guarda de path escape
  const clone = await readFile(path.join(ROOT, "scripts/clone.mjs"), "utf8");
  for (const needle of [
    "ensureInside",
    "sanitizePathSegments",
    "assertHttpUrl",
    "MAX_ASSET_BYTES",
  ]) {
    if (!clone.includes(needle)) fail(`clone.mjs sem ${needle}`);
    else pass(`clone.mjs contém ${needle}`);
  }

  // 5) Hash do lockfile (integridade reproduzível)
  try {
    const lock = await readFile(path.join(ROOT, "package-lock.json"));
    const sha = createHash("sha256").update(lock).digest("hex").slice(0, 16);
    pass(`package-lock.json presente (sha256…${sha})`);
  } catch {
    fail("package-lock.json ausente");
  }

  // 6) Playwright resolvido localmente
  try {
    const st = await stat(path.join(ROOT, "node_modules/playwright/package.json"));
    if (st.isFile()) {
      const pw = JSON.parse(
        await readFile(path.join(ROOT, "node_modules/playwright/package.json"), "utf8")
      );
      pass(`playwright instalado: ${pw.version}`);
    }
  } catch {
    pass("playwright ainda não instalado (rode npm install)");
  }

  console.log("\n=== Validação site-cloner ===\n");
  for (const m of ok) console.log(`  OK  ${m}`);
  for (const m of errors) console.log(`  ERR ${m}`);
  console.log("");
  if (errors.length) {
    console.log(`FALHOU: ${errors.length} problema(s)`);
    process.exit(1);
  }
  console.log("PASSOU: pacote parece seguro para uso local.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
