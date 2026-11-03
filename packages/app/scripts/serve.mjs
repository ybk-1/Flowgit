// A static server for dist/, with the headers from dist/_headers (as Cloudflare Pages would send).
// For the end-to-end tests and for trying the build: node scripts/serve.mjs [port]
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "dist");
const port = Number(process.argv[2] ?? process.env.PORT ?? 4178);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".map": "application/json" };
const headers = Object.fromEntries(
  fs
    .readFileSync(path.join(dist, "_headers"), "utf8")
    .split("\n")
    .filter((line) => line.startsWith("  "))
    .map((line) => {
      const at = line.indexOf(":");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

http
  .createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    const rel = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
    const abs = path.join(dist, rel);
    if (!abs.startsWith(dist + path.sep) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      res.writeHead(404, headers).end("not found");
      return;
    }
    res.writeHead(200, { ...headers, "Content-Type": TYPES[path.extname(abs)] ?? "application/octet-stream" });
    fs.createReadStream(abs).pipe(res);
  })
  .listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}/`));
