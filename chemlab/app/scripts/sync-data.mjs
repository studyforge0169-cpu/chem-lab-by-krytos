// Copy the shipped warehouse into public/data and write a manifest the app can quote.
// The app must always be able to say which build of the data it is showing, so the manifest
// carries size, sha256, row counts and the build timestamp of each file - computed here,
// never typed.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, copyFileSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..");
const src = resolve(app, "..", "data");
const out = join(app, "public", "data");
mkdirSync(out, { recursive: true });

const files = ["chemlab.json.gz", "combinations.json.gz"];
const manifest = { generated: new Date().toISOString().replace(/\.\d+Z$/, "Z"), files: {} };

for (const f of files) {
  const from = join(src, f);
  if (!existsSync(from)) {
    console.error(`[sync-data] missing ${from} - build the warehouse first (see ../README.md)`);
    process.exit(1);
  }
  copyFileSync(from, join(out, f));
  const buf = readFileSync(join(out, f));
  // rows counted from the decompressed bytes, so the manifest describes the data itself
  const doc = JSON.parse(gunzipSync(buf).toString("utf8"));
  const counts = f.startsWith("chemlab")
    ? {
        species: doc.species?.length ?? 0,
        reactions: doc.reactions?.length ?? 0,
        elements: doc.elements?.length ?? 0,
        ion_pairs: doc.tables?.precipitation_matrix
          ? Object.keys(doc.tables.precipitation_matrix).length
          : 0,
        ksp: Object.keys(doc.tables?.ksp ?? {}).length,
        e0: Object.keys(doc.tables?.e0 ?? {}).length,
        pka: Object.keys(doc.tables?.pka ?? {}).length,
      }
    : { combinations: doc.combinations?.length ?? 0, pair_rows_meta: doc.meta?.what ? 1 : 0 };
  manifest.files[f] = {
    bytes: statSync(join(out, f)).size,
    sha256: createHash("sha256").update(buf).digest("hex"),
    data_generated: doc.meta?.generated ?? doc.meta?.generated_utc ?? null,
    counts,
  };
  // an uncompressed copy for the dev server, so a browser without DecompressionStream
  // (and the vitest node run) can still read the same bytes
  const raw = join(out, f.replace(/\.gz$/, "")); // chemlab.json.gz -> chemlab.json, the name load.ts asks for
  writeFileSync(raw, gunzipSync(buf));
  manifest.files[f].raw_bytes = statSync(raw).size;
}
manifest.build_id = createHash("sha1")
  .update(files.map((f) => manifest.files[f].sha256).join(""))
  .digest("hex")
  .slice(0, 12);
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 1));
console.log(
  `[sync-data] ${files.length} files, build ${manifest.build_id}, ` +
    `${(manifest.files["chemlab.json.gz"].bytes / 1024) | 0} K + ` +
    `${(manifest.files["combinations.json.gz"].bytes / 1024) | 0} K`,
);
