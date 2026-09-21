/** Write dist/sw.js from public/sw.js with two things filled in from what is actually in dist:
 *  the build id (so the cache name changes when the data changes) and the precache list (so the
 *  shell can be served whole by a cold start with no network at all).
 *
 *  It also writes dist/precache.json: the same list with sizes, which is what the transfer budget
 *  in tests/ship.test.ts is measured against. */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve, dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(app, "dist");
const src = join(app, "public", "sw.js");

function walk(dir, prefix = "") {
  const out = [];
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    const rel = posix.join(prefix, f.name);
    if (f.isDirectory()) out.push(...walk(p, rel));
    else out.push(rel);
  }
  return out;
}

let files;
try {
  files = walk(dist);
} catch (e) {
  console.log(`[sw] no dist to work with (${String(e && e.message ? e.message : e)}); run vite build first`);
  process.exit(1);
}

let build = "unknown";
try {
  build = JSON.parse(readFileSync(join(dist, "data", "manifest.json"), "utf8")).build_id ?? "unknown";
} catch {
  console.log("[sw] dist/data/manifest.json is not there: the cache name will say 'unknown', and the app will say it has no manifest");
}

// what a cold start needs, in the order it is needed
const keep = files.filter(
  (f) =>
    f === "index.html" ||
    f === "manifest.webmanifest" ||
    f.startsWith("assets/") ||
    f.startsWith("icons/") ||
    (f.startsWith("data/") && (f.endsWith(".gz") || f === "data/manifest.json")),
);
const urls = keep.map((f) => (f === "index.html" ? "./" : "./" + f));
if (!urls.includes("./index.html")) urls.push("./index.html");

const rows = keep.map((f) => {
  const bytes = statSync(join(dist, f)).size;
  const gz = f.endsWith(".gz") ? bytes : gzipSync(readFileSync(join(dist, f)), { level: 9 }).length;
  return { file: f, bytes, gz };
});
const total = rows.reduce((s, r) => s + r.gz, 0);

let text = readFileSync(src, "utf8");
text = text.replace(/\/\*__BUILD__\*\/[\s\S]*?\/\*__END_BUILD__\*\//, `/* build ${build} — written by scripts/gen-sw.mjs */ const BUILD = ${JSON.stringify(build)};`);
text = text.replace(
  /\/\*__PRECACHE__\*\/[\s\S]*?\/\*__END_PRECACHE__\*\//,
  `/* ${rows.length} files, ${(total / 1048576).toFixed(3)} MB after gzip */ const PRECACHE = ${JSON.stringify(urls)};`,
);
writeFileSync(join(dist, "sw.js"), text);
writeFileSync(
  join(dist, "precache.json"),
  JSON.stringify(
    {
      generated: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      build_id: build,
      files: rows,
      total_bytes: rows.reduce((s, r) => s + r.bytes, 0),
      total_gz: total,
      scope: "everything the first paint needs; the app then works with the network off",
    },
    null,
    1,
  ),
);
console.log(
  `[sw] dist/sw.js for build ${build.slice(0, 12)}: ${urls.length} files precached, ${rows.length} counted, ${(total / 1048576).toFixed(3)} MB over the wire`,
);
