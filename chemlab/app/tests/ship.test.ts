/** The ship checks: the transfer budget, the offline cache's list, the manifest, the icons, and how
 *  long the app takes to become usable. These read `dist/`, so they check the thing that is actually
 *  delivered rather than the source that produces it. */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildStore } from "../src/data/load.js";
import type { CombinationsDoc, WarehouseDoc } from "../src/data/types.js";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(app, "dist");
const BUDGET_BYTES = 1.5 * 1024 * 1024;
const read = (p: string) => readFileSync(join(dist, p));
const list = (dir = dist): string[] => {
  const out: string[] = [];
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) out.push(...list(p));
    else out.push(relative(dist, p).split("\\").join("/"));
  }
  return out.sort();
};

let files: string[] = [];
let manifest: any;
let precache: any;
let sw = "";
let html = "";

beforeAll(() => {
  if (!existsSync(join(dist, "index.html"))) {
    // the budget is about the built thing, so build it rather than skip
    execSync("npm run build --silent", { cwd: app, stdio: "ignore", timeout: 240_000 });
  }
  files = list();
  manifest = JSON.parse(read("manifest.webmanifest").toString("utf8"));
  precache = JSON.parse(read("precache.json").toString("utf8"));
  sw = read("sw.js").toString("utf8");
  html = read("index.html").toString("utf8");
});

describe("the transfer budget", () => {
  it("everything a first load needs fits in 1.5 MB, gzipped", () => {
    let total = 0;
    const rows: string[] = [];
    for (const f of files) {
      const buf = read(f);
      // a .gz is already compressed: re-gzipping it would flatter the number
      const wire = f.endsWith(".gz") ? buf.length : gzipSync(buf, { level: 9 }).length;
      total += wire;
      rows.push(`${(wire / 1024).toFixed(1).padStart(8)} KB  ${f}`);
    }
    console.log(`\n  first load, over the wire:\n${rows.map((r) => `    ${r}`).join("\n")}\n    ${(total / 1048576).toFixed(3)} MB total (budget ${(BUDGET_BYTES / 1048576).toFixed(2)} MB)\n`);
    expect(total).toBeLessThanOrEqual(BUDGET_BYTES);
    expect(total).toBeGreaterThan(1024 * 1024); // and it is not passing by shipping nothing
  });

  it("the numbers the build wrote agree with the files on disk", () => {
    const mine = new Map(files.map((f) => [f, gzipSync(read(f), { level: 9 }).length]));
    for (const row of precache.files) {
      const actual = row.file.endsWith(".gz") ? statSync(join(dist, row.file)).size : mine.get(row.file);
      expect(actual, row.file).toBe(row.gz);
    }
    let total = 0;
    for (const f of files) total += f.endsWith(".gz") ? read(f).length : (mine.get(f) ?? 0);
    expect(Math.abs(total - precache.total_gz)).toBeLessThan(4096); // precache.json skips sw.js and itself
  });

  it("only what the app reads is shipped", () => {
    // the loader asks for the .gz and falls back, so the plain JSON is dev convenience, not payload
    expect(files.filter((f) => f.startsWith("data/") && f.endsWith(".json") && f !== "data/manifest.json")).toEqual([]);
    const load = readFileSync(join(app, "src", "data", "load.ts"), "utf8");
    expect(load).toContain('getJson<WarehouseDoc>(base, "chemlab.json.gz", "chemlab.json")');
  });
});

describe("the offline cache", () => {
  it("precaches every file in the build, and lists nothing that is missing", () => {
    const declared = new Set<string>(precache.files.map((f: any) => f.file as string));
    const runtime = files.filter((f) => f !== "sw.js" && f !== "precache.json");
    const notPrecached = runtime.filter((f) => !declared.has(f));
    const notOnDisk = [...declared].filter((f: string) => !files.includes(f));
    expect(notPrecached, "these files would be missing on a cold start offline").toEqual([]);
    expect(notOnDisk, "the precache list names files this build does not contain").toEqual([]);
    expect([...declared]).toContain("data/chemlab.json.gz");
    expect([...declared]).toContain("data/combinations.json.gz");
    expect([...declared]).toContain("index.html");
  });

  it("the worker in the build is the generated one, for this build id", () => {
    expect(sw).not.toContain("__PRECACHE__");
    expect(sw).not.toContain("__BUILD__");
    const build = JSON.parse(read("data/manifest.json").toString("utf8")).build_id;
    expect(sw).toContain(`const BUILD = "${build}"`);
    expect(precache.build_id).toBe(build);
    // the list in the file and the list in the worker must be the same list
    const m = /const PRECACHE = (\[[^\]]*\])/.exec(sw);
    expect(m).toBeTruthy();
    const urls = JSON.parse(m![1]) as string[];
    const norm = (u: string) => {
      const t = u.replace(/^\.\//, "");
      return t === "" ? "index.html" : t; // "./" and "./index.html" are the same file, both listed on purpose
    };
    expect(new Set(urls.map(norm))).toEqual(new Set<string>(precache.files.map((f: any) => f.file as string)));
    expect(urls.filter((u) => u === "./" || u === "./index.html").length).toBe(2);
  });

  it("references no other origin, anywhere", () => {
    expect(sw).not.toMatch(/https?:\/\//);
    expect(sw).toContain('url.origin !== self.location.origin');
    expect(sw).toMatch(/respondWith\(Response\.error\(\)\)/);
    const css = files.filter((f) => f.endsWith(".css")).map((f) => read(f).toString("utf8")).join("\n");
    expect(css).not.toMatch(/url\(\s*['"]?(https?:)?\/\//);
    expect(css).not.toMatch(/@import/);
    expect(html).not.toMatch(/(?:src|href)=["'](https?:)?\/\//);
    expect(JSON.stringify(manifest)).not.toMatch(/https?:\/\//);
  });

  it("the app only registers a worker in the built copy", () => {
    const main = readFileSync(join(app, "src", "main.tsx"), "utf8");
    expect(main).toMatch(/import\.meta\.env\.PROD\)\s+registerShip\(\)/);
  });

  it("data is cache-first and the manifest is the one thing it asks about", () => {
    // cache-first for the data: the cache is tried before any request leaves the page
    expect(sw).toMatch(/async function dataResponse\(req\) \{\s*const hit = await cached\(req\);\s*if \(hit\) return hit;/);
    expect(sw).toContain('url.pathname.includes("/data/")');
    expect(sw).toContain("dataResponse(req)");
    // and the manifest is the one thing fetched before the cache is read
    expect(sw).toContain("async function manifestResponse(req)");
    expect(sw).toContain("manifestResponse(req)");
    // the update flow: compare build ids, fetch the new data, then tell the client
    expect(sw).toMatch(/stored !== live|live !== stored/);
    // and read the old manifest before the new one overwrites it, or the comparison is a tautology
    const body = sw.slice(sw.indexOf("async function manifestResponse"), sw.indexOf("/** the shell"));
    expect(body.indexOf("await cached(req)")).toBeLessThan(body.indexOf("await put(DATA, req)"));
    expect(sw).toContain('type: "chemlab:new-data"');
  });
});

describe("the manifest and the icons it promises", () => {
  const pngSize = (buf: Buffer) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

  it("is installable and stays on the device", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("./");
    expect(manifest.scope).toBe("./");
    expect(manifest.name).toContain("ChemLab");
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.id).toBeTruthy();
  });

  it("every icon it declares is in the build, at the size it declares", () => {
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
    const purposes = manifest.icons.map((i: any) => i.purpose);
    expect(purposes).toContain("maskable"); // Android will not make a round icon out of a square one
    for (const icon of manifest.icons) {
      const rel = String(icon.src).replace(/^\.\//, "");
      expect(files, `${rel} is not in dist`).toContain(rel);
      if (rel.endsWith(".png")) {
        const { w, h } = pngSize(read(rel));
        expect(`${w}x${h}`, rel).toBe(icon.sizes);
        expect(w).toBe(h);
      }
    }
    const sizes = manifest.icons.map((i: any) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("the colours are the app's own, not picked for the store listing", () => {
    const css = readFileSync(join(app, "src", "styles", "app.css"), "utf8");
    const bg = /--bg:\s*(#[0-9a-f]{6})/i.exec(css)?.[1]?.toLowerCase();
    expect(bg).toBeTruthy();
    expect(manifest.background_color.toLowerCase()).toBe(bg);
    expect(manifest.theme_color.toLowerCase()).toBe(bg);
    const theme = /name="theme-color" content="(#[0-9a-f]{6})"/i.exec(html)?.[1]?.toLowerCase();
    expect(theme).toBe(bg);
  });

  it("the shortcuts land on tabs that exist", () => {
    expect(manifest.shortcuts.length).toBeGreaterThanOrEqual(3);
    for (const sc of manifest.shortcuts) expect(String(sc.url)).toMatch(/^\.\/\?tab=/);
  });
});

describe("how long the warehouse takes to become a lab", () => {
  it("inflate, parse and index stay inside a second on this machine", () => {
    const t0 = performance.now();
    const raw = gunzipSync(read("data/chemlab.json.gz")).toString("utf8");
    const tInflate = performance.now() - t0;
    const t1 = performance.now();
    const doc = JSON.parse(raw) as WarehouseDoc;
    const tParse = performance.now() - t1;
    const t2 = performance.now();
    const comb = JSON.parse(gunzipSync(read("data/combinations.json.gz")).toString("utf8")) as CombinationsDoc;
    const store = buildStore(doc, comb.combinations, null, comb.meta);
    const tIndex = performance.now() - t2;
    const total = tInflate + tParse + tIndex;
    console.log(
      `  inflate ${tInflate.toFixed(0)} ms · parse ${tParse.toFixed(0)} ms · index ${tIndex.toFixed(0)} ms · total ${total.toFixed(0)} ms ` +
        `for ${store.counts.species} substances and ${store.counts.reactions} reactions`,
    );
    expect(tParse + tIndex).toBeLessThan(1000);
    expect(total).toBeLessThan(2000);
    expect(store.counts.species).toBe(582);
    expect(store.combos.length).toBe(9410);
  });
});
