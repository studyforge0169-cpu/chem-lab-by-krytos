// A deliberately small static server: the preview must not depend on a framework, and the
// app is static after `npm run build`. Binds 0.0.0.0, serves dist/, and never caches.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, normalize } from "node:path";

// args: [dir] [--port N] [--host H]; the flags are accepted as well as the bare positionals,
// because `npm run serve -- --port 4173` is the shape everybody reaches for first
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.split("=")[1] : dflt;
};
const positional = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
const root = resolve(positional[0] || "dist");
const port = Number(flag("port", positional[1] || 8080));
const host = flag("host", "0.0.0.0");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".gz": "application/gzip", ".svg": "image/svg+xml", ".png": "image/png",
  ".webmanifest": "application/manifest+json", ".ico": "image/x-icon",
};
createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://x");
    let p = normalize(decodeURIComponent(url.pathname));
    if (p === "/" || p === "\\") p = "/index.html";
    let file = join(root, p);
    try {
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    } catch {
      file = join(root, "index.html"); // SPA fallback: any path is the app
    }
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] || "application/octet-stream",
      "cache-control": "no-cache",
      "access-control-allow-origin": "*",
    });
    res.end(body);
  } catch (e) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end(String(e && e.message ? e.message : e));
  }
}).listen(port, host, () => console.log(`[serve] ${root} on ${host}:${port}`));
