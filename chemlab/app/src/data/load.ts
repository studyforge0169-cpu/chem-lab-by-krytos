/** One fetch, one parse, then a store with the indexes every screen needs.
 *
 *  The app ships ~1.2 MB of gzipped JSON and no backend, so the loader is the thing that
 *  decides whether the first screen is fast. It reports its own timings, because a perf
 *  budget you cannot see is a wish. */
import type {
  CombinationRec,
  CombinationsDoc,
  ElementRec,
  PrecipRow,
  ReactionRec,
  SpeciesRec,
  Store,
  WarehouseDoc,
} from "./types.js";
import { buildSearch } from "./search.js";

export interface ManifestFile {
  bytes: number;
  sha256: string;
  data_generated: string | null;
  counts: Record<string, number>;
  raw_bytes?: number;
}
export interface Manifest {
  generated: string;
  build_id: string;
  files: Record<string, ManifestFile>;
}

export interface LoadTimings {
  fetch_ms: number;
  inflate_ms: number;
  parse_ms: number;
  index_ms: number;
  total_ms: number;
  bytes: number;
}
export interface Loaded {
  store: Store;
  manifest: Manifest | null;
  timings: LoadTimings;
}

const t = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** gzip, in the one way a browser does it without a library. Node (the tests) has zlib. */
async function inflate(buf: ArrayBuffer): Promise<string> {
  const DS = (globalThis as any).DecompressionStream;
  if (typeof DS === "function") {
    const stream = new Blob([buf]).stream().pipeThrough(new DS("gzip"));
    return await new Response(stream).text();
  }
  throw new Error(
    "this browser has no DecompressionStream, so the 1 MB payload cannot be inflated here - " +
      "the uncompressed copy is only served in development",
  );
}

const stats = { bytes: 0, fetch_ms: 0, inflate_ms: 0, parse_ms: 0 };

async function getJson<T>(base: string, gz: string, raw: string): Promise<T> {
  const t0 = t();
  try {
    const r = await fetch(`${base}/${gz}`, { cache: "force-cache" });
    if (!r.ok) throw new Error(`${gz}: HTTP ${r.status}`);
    const buf = await r.arrayBuffer();
    stats.bytes += buf.byteLength;
    stats.fetch_ms += t() - t0;
    const i0 = t();
    const text = await inflate(buf);
    stats.inflate_ms += t() - i0;
    const p0 = t();
    const doc = JSON.parse(text) as T;
    stats.parse_ms += t() - p0;
    return doc;
  } catch (e) {
    // dev/server fallback: the sync step writes an uncompressed twin next to every .gz
    const r = await fetch(`${base}/${raw}`);
    if (!r.ok) throw e instanceof Error ? new Error(`${e.message} (and ${raw}: HTTP ${r.status})`) : e;
    stats.bytes += Number(r.headers.get("content-length") || 0);
    const p0 = t();
    const doc = (await r.json()) as T;
    stats.parse_ms += t() - p0;
    return doc;
  }
}
/** Everything below is a Map the screens would otherwise rebuild on every render. */
export function buildStore(
  doc: WarehouseDoc,
  combinations: CombinationRec[],
  manifest: Manifest | null = null,
  combosMeta: any = null,
): Store {
  const i0 = t();
  const elements = doc.elements ?? [];
  const species = doc.species ?? [];
  const reactions = doc.reactions ?? [];
  const precipList: PrecipRow[] = Object.values(doc.tables?.precipitation_matrix ?? {});

  const elementBySymbol = new Map<string, ElementRec>();
  const elementByNumber = new Map<number, ElementRec>();
  for (const e of elements) {
    elementBySymbol.set(e.symbol, e);
    elementByNumber.set(e.number, e);
  }
  const speciesById = new Map<string, SpeciesRec>();
  for (const s of species) speciesById.set(s.id, s);

  const reactionById = new Map<string, ReactionRec>();
  const reactionsBySpecies = new Map<string, ReactionRec[]>();
  const push = <V,>(map: Map<string, V[]>, k: string, v: V) => {
    const a = map.get(k);
    if (a) a.push(v);
    else map.set(k, [v]);
  };
  for (const r of reactions) {
    reactionById.set(r.id, r);
    for (const list of [r.reactants, r.products]) {
      for (const term of list ?? []) {
        if (term.species_id) push(reactionsBySpecies, term.species_id, r);
      }
    }
  }

  const precip = new Map<string, PrecipRow>();
  // a salt dissolving back: which ion pairs produce this neutral formula? this is what the
  // bench uses to answer "I mixed two bottles, which row of the matrix is that?"
  const precipByProduct = new Map<string, PrecipRow[]>();
  const ionOf = new Map<string, { role: "cation" | "anion"; key: string; other: string }>();
  for (const row of precipList) {
    const key = `${row.cation_id}|${row.anion_id}`;
    precip.set(key, row);
    push(precipByProduct, row.product_hill, row);
    ionOf.set(row.cation_id, { role: "cation", key: row.cation_id, other: row.anion_id });
  }

  const combosByPair = new Map<string, CombinationRec[]>();
  const combosByStatus = new Map<string, number>();
  for (const c of combinations) {
    const a = c.elements?.[0] ?? "";
    const b = c.elements?.[1] ?? "";
    const sorted = [a, b].sort().join("-");
    push(combosByPair, sorted, c);
    /* and under the string the row itself carries: sheets are opened by pair name from a dozen
       places, and "Mn-B" must find the same rows as "B-Mn" or the link goes quietly nowhere */
    if (c.pair && c.pair !== sorted) push(combosByPair, c.pair, c);
    combosByStatus.set(c.status, (combosByStatus.get(c.status) ?? 0) + 1);
  }

  const search = buildSearch(doc, combinations);
  const store: Store = {
    doc,
    manifest,
    buildId: manifest?.build_id ?? String(doc.meta?.generated ?? "unmanaged"),
    dataGenerated: doc.meta?.generated ?? manifest?.files["chemlab.json.gz"]?.data_generated ?? "",
    elements,
    elementBySymbol,
    elementByNumber,
    species,
    speciesById,
    reactions,
    reactionById,
    reactionsBySpecies,
    precip,
    precipList,
    precipByProduct,
    ionOf,
    combos: combinations,
    combosMeta,
    combosByPair,
    combosByStatus,
    counts: {
      elements: elements.length,
      species: species.length,
      reactions: reactions.length,
      ion_pairs: precipList.length,
      combinations: combinations.length,
      ksp: Object.keys(doc.tables?.ksp ?? {}).length,
      pka: Object.keys(doc.tables?.pka ?? {}).length,
      e0: Object.keys(doc.tables?.e0 ?? {}).length,
      thermo: Object.keys(doc.tables?.thermo ?? {}).length,
      glassware: (doc.tables?.glassware ?? []).length || Object.keys(doc.tables?.glassware ?? {}).length,
    },
    search,
  };
  const index_ms = t() - i0;
  (store as any).index_ms = index_ms;
  return store;
}

export async function loadApp(base = "./data"): Promise<Loaded> {
  const t0 = t();
  stats.bytes = stats.fetch_ms = stats.inflate_ms = stats.parse_ms = 0;
  let manifest: Manifest | null = null;
  try {
    const r = await fetch(`${base}/manifest.json`, { cache: "no-cache" });
    if (r.ok) manifest = (await r.json()) as Manifest;
  } catch {
    manifest = null; // a bare static copy without a manifest still works; it just cannot
  }                    // say which build it is, and the header will say so
  const doc = await getJson<WarehouseDoc>(base, "chemlab.json.gz", "chemlab.json");
  const comb = await getJson<CombinationsDoc>(base, "combinations.json.gz", "combinations.json");
  const store = buildStore(doc, comb?.combinations ?? [], manifest, comb?.meta ?? null);
  const timings: LoadTimings = {
    fetch_ms: stats.fetch_ms,
    inflate_ms: stats.inflate_ms,
    parse_ms: stats.parse_ms,
    index_ms: (store as any).index_ms ?? 0,
    total_ms: t() - t0,
    bytes: stats.bytes,
  };
  return { store, manifest, timings };
}
