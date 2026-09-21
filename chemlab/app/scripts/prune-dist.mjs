/** Ship only what the app reads. `npm run sync` writes both `chemlab.json` and `chemlab.json.gz`
 *  into public/data — the plain one exists so a dev server without content-encoding, or an editor,
 *  can read the file — but the loader asks for the .gz and only falls back, so the uncompressed
 *  copies are 5 MB of weight for a phone that never asks for them. */
import { readdirSync, rmSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "data");
let freed = 0;
let dropped = 0;
try {
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f === "manifest.json") continue;
    const p = resolve(dir, f);
    freed += statSync(p).size;
    rmSync(p);
    dropped++;
  }
} catch (e) {
  console.log(`[prune] nothing to prune (${String(e && e.message ? e.message : e)})`);
  process.exit(0);
}
console.log(`[prune] dropped ${dropped} uncompressed JSON file${dropped === 1 ? "" : "s"} from dist/data — ${(freed / 1048576).toFixed(2)} MB; the loader reads the .gz copies`);
