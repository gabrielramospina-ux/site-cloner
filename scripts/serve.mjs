#!/usr/bin/env node
/**
 * Serve um clone offline no localhost, mapeando caminhos absolutos
 * (/_next, /brand, /media, …) para _assets/<host>/…
 *
 * Uso:
 *   npm run serve -- ./output/vdkids
 *   npm run serve -- ./output/vdkids --port 4173
 */
import { createServer } from "node:http";
import { readFile, stat, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json",
};

function parseArgs(argv) {
  const args = { dir: null, port: 4173, host: "127.0.0.1" };
  const rest = [...argv];
  while (rest.length) {
    const t = rest.shift();
    if (t === "--port") args.port = Number(rest.shift());
    else if (t === "--host") args.host = rest.shift();
    else if (t === "--help" || t === "-h") args.help = true;
    else if (!t.startsWith("-") && !args.dir) args.dir = t;
  }
  return args;
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split("?")[0] || "/");
  const cleaned = path.posix.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
  const abs = path.resolve(root, "." + cleaned);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return abs;
}

async function exists(file) {
  try {
    const s = await stat(file);
    return s.isFile() ? file : null;
  } catch {
    return null;
  }
}

async function findAssetHosts(root) {
  const assetsRoot = path.join(root, "_assets");
  try {
    const entries = await readdir(assetsRoot, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function resolveFile(root, hosts, urlPath) {
  const candidates = [];
  const direct = safeJoin(root, urlPath);
  if (direct) candidates.push(direct);

  // /foo → /foo/index.html | /foo.html
  if (direct && !path.extname(direct)) {
    candidates.push(path.join(direct, "index.html"));
    candidates.push(`${direct}.html`);
  }
  if (urlPath === "/" || urlPath === "") {
    candidates.push(path.join(root, "index.html"));
  }

  // Absolute site paths → _assets/<host>/…
  const stripped = urlPath.replace(/^\//, "");
  for (const host of hosts) {
    candidates.push(path.join(root, "_assets", host, stripped));
    if (!path.extname(stripped)) {
      candidates.push(path.join(root, "_assets", host, stripped, "index.html"));
    }
  }

  for (const c of candidates) {
    const hit = await exists(c);
    if (hit) return hit;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.dir) {
    console.log(
      "Uso: npm run serve -- <dir-do-clone> [--port 4173] [--host 127.0.0.1]"
    );
    process.exit(args.help ? 0 : 1);
  }
  if (!Number.isFinite(args.port) || args.port < 1 || args.port > 65535) {
    throw new Error("--port inválido");
  }

  const root = path.resolve(ROOT, args.dir);
  const hosts = await findAssetHosts(root);
  const indexOk = await exists(path.join(root, "index.html"));
  if (!indexOk) {
    throw new Error(`Sem index.html em ${root}`);
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${args.host}`);
      const file = await resolveFile(root, hosts, url.pathname);
      if (!file) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("404 Not Found");
        return;
      }
      const body = await readFile(file);
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(body);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(String(err.message || err));
    }
  });

  server.listen(args.port, args.host, () => {
    console.log(`→ Clone:  ${root}`);
    console.log(`→ Assets: ${hosts.join(", ") || "(nenhum _assets/)"}`);
    console.log(`→ Local:  http://${args.host}:${args.port}/`);
  });
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
