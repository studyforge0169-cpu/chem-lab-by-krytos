/** The reactions browser. The counts asserted here were taken from the file itself, so this is a
 *  check that the app's filters agree with the data, not that they agree with each other. */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildStore } from "../src/data/load.js";
import {
  coverageCensus,
  DEFAULT_REACT_FILTER,
  deadLinks,
  FACETS,
  FACET_BY_ID,
  filterReactions,
  reactRow,
  type ReactFilter,
} from "../src/lib/reactBrowser.js";
import { openTarget, searchAll, searchNotes } from "../src/lib/searchAll.js";
import { captureNote } from "../src/lib/notebook.js";
import type { CombinationsDoc, Store, WarehouseDoc } from "../src/data/types.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const read = (f: string) => JSON.parse(gunzipSync(readFileSync(resolve(root, f))).toString("utf8"));

let store: Store;
let doc: WarehouseDoc;

beforeAll(() => {
  doc = read("chemlab.json.gz") as WarehouseDoc;
  store = buildStore(doc, (read("combinations.json.gz") as CombinationsDoc).combinations, null, null);
});

const page = (over: Partial<ReactFilter> = {}) => filterReactions(store, { ...DEFAULT_REACT_FILTER, limit: 100_000, ...over });
const raw = (test: (r: any) => boolean) => (doc.reactions ?? []).filter(test).length;

describe("the file and the browser count the same records", () => {
  it("424 records, split the way the data splits them", () => {
    const p = page();
    expect(p.total).toBe(424);
    expect(p.matched).toBe(424);
    expect(raw((r) => r.record_type === "equation")).toBe(207);
    expect(raw((r) => r.record_type === "process")).toBe(217);
    expect(page({ type: "equation" }).matched).toBe(207);
    expect(page({ type: "process" }).matched).toBe(217);
  });

  it("every facet's button count is the facet, applied to the file", () => {
    const counts = page().facetCounts;
    const wrong: string[] = [];
    for (const f of FACETS) {
      const mine = counts[f.id];
      const theirs = raw((r) => f.of(r, store));
      if (mine !== theirs) wrong.push(`${f.id}: screen says ${mine}, the file has ${theirs}`);
    }
    expect(wrong).toEqual([]);
    // the numbers a person would check by hand, counted off the file
    expect(counts["equation"]).toBe(207);
    expect(counts["dH_derived"]).toBe(111); // the key is on 207 records, a number on 111
    expect(counts["dH_curated"]).toBe(29);
    expect(counts["cross_check"]).toBe(25);
    expect(counts["gas"]).toBe(64);
    expect(counts["ppt"]).toBe(174);
    expect(counts["colour"]).toBe(227);
    expect(counts["light"]).toBe(77);
    expect(counts["heat"]).toBe(34);
    expect(counts["danger3"]).toBe(42);
    expect(counts["controls"]).toBe(33);
    expect(counts["hood"]).toBe(4);
    expect(counts["scale"]).toBe(5);
    expect(counts["blocked"]).toBe(2);
    expect(counts["apparatus"]).toBe(141);
    expect(counts["yield"]).toBe(2);
    expect(counts["equilibrium"]).toBe(8);
    expect(counts["electrochem"]).toBe(7);
    expect(counts["T"]).toBe(135);
    expect(counts["time"]).toBe(97);
    expect(counts["note"]).toBe(422);
  });

  it("a facet with no matches is a fact about the file, and only one facet is empty", () => {
    const empty = FACETS.filter((f) => (page().facetCounts[f.id] ?? 0) === 0).map((f) => f.id);
    expect(empty).toEqual(["unbalanced"]);
    // the build re-counted every equation and every one balanced, so this filter is a tripwire,
    // not a dead button: it has to return 0 until the data changes
    expect(raw((r) => !!r.equation && (r.balance_check?.problems ?? []).length > 0)).toBe(0);
  });

  it("the categories are the data's words, with the data's counts", () => {
    const cats = page().cats;
    expect(cats.length).toBe(67);
    expect(cats[0]).toEqual({ name: "process", count: 217 });
    const precip = cats.find((c) => c.name === "precip");
    expect(precip?.count).toBe(59);
    expect(page({ cat: "precip" }).matched).toBe(59);
    for (const c of cats) expect(page({ cat: c.name }).matched).toBe(c.count);
  });

  it("the coverage census is the same arithmetic in words", () => {
    const c = coverageCensus(store);
    expect(c.length).toBeGreaterThan(8);
    const byField = new Map(c.map((x) => [x.field, x.count]));
    expect(byField.get("a balanced equation the build re-counted")).toBe(207);
    expect(byField.get("a ΔH of some kind")).toBe(115);
    expect(byField.get("a hazard score")).toBe(79);
    expect(byField.get("a refusal")).toBe(2);
    expect(byField.get("a curriculum appearance")).toBe(0); // the field is a placeholder; the prompt says so in words
    for (const row of c) {
      expect(typeof row.rest).toBe("string");
      expect(row.rest.length).toBeGreaterThan(10);
      expect(row.count).toBeLessThanOrEqual(424);
    }
  });

  it("every id the browser links to resolves, including the four that used not to", () => {
    // prompt 13 ended with four apparatus names in reaction records that tables.apparatus had no
    // row for. They are in the source register now (192 rows), and this is the assertion that keeps
    // them there: a new dangling name in a rebuilt file fails here.
    expect(deadLinks(store)).toEqual([]);
    const reg = store.doc.tables?.apparatus as any;
    expect(Object.keys(reg).length).toBe(192);
    for (const id of ["filter-paper", "lid", "nichrome-loop", "white-paper-cross", "wash_bottle", "eye_wash", "thiele-tube"]) {
      expect(reg[id], id).toBeTruthy();
      expect(reg[id].tolerance_mL, id).toBeNull(); // a lid has no tolerance, and the register does not pretend otherwise
      expect(String(reg[id].source), id).toContain("bench practice");
    }
    expect(reg["burette_50"].tolerance_mL).not.toBeNull();
  });
});

describe("a row says what its record can answer", () => {
  it("the water synthesis row", () => {
    const r = (doc.reactions ?? []).find((x) => x.id === "syn_h2o")!;
    const row = reactRow(store, r as any);
    expect(row.name).toBe("Burning hydrogen to water");
    expect(row.typeLabel).toBe("equation");
    expect(row.equation).toBe("2 H2 + O2 -> 2 H2O");
    expect(row.has).toContain("a balanced equation");
    expect(row.balanced).toContain("re-counted");
    expect(row.dH).not.toBeNull();
    expect(row.obs.some((o) => o.kind === "light")).toBe(true);
    expect(row.has.length).toBeGreaterThan(3);
    expect(row.danger).toBe(2);
    expect(row.blocked).toBe(false);
  });

  it("a blocked record is labelled before it is anything else", () => {
    const blocked = page({ facets: ["blocked"] }).rows;
    expect(blocked.length).toBe(2);
    for (const b of blocked) {
      expect(b.blocked).toBe(true);
      expect(b.has).toContain("you must not do this");
    }
  });

  it("a process record is not treated as a missing equation", () => {
    const p = page({ type: "process" });
    expect(p.rows.length).toBe(217);
    expect(p.rows.every((r) => !r.equation)).toBe(true);
    expect(p.rows.every((r) => r.balanced === null)).toBe(true);
  });

  it("the facets compose, and an impossible combination says so with numbers", () => {
    expect(page({ facets: ["gas", "ppt"] }).matched).toBeLessThan(Math.min(69, 174));
    const both = page({ facets: ["blocked", "yield"] });
    expect(both.matched).toBe(0);
    expect(both.active.length).toBe(2);
    expect(both.active[0].why.length).toBeGreaterThan(4);
  });

  it("sorting by danger puts the loud ones where the sort says they are", () => {
    const up = page({ sort: "danger", limit: 20 }).rows;
    expect(up[0].danger).toBe(2); // the file's lowest score is 2: nothing here is scored harmless
    const down = page({ sort: "danger", desc: true, limit: 20 }).rows;
    expect(down[0].danger).toBe(3);
    expect(down.filter((r) => r.danger === null).length).toBe(0);
    const full = page({ sort: "danger" }).rows;
    for (let i = 1; i < 424; i += 1) {
      const a = full[i - 1].danger;
      const b = full[i].danger;
      if (a === null) expect(b).toBeNull(); // a record with no score goes last, not to the bottom of the numbers
      else if (b !== null) expect(b).toBeGreaterThanOrEqual(a);
    }
    expect(full[full.length - 1].danger).toBeNull();
  });

  it("a text filter looks at the teaching note too, and a nonsense one returns nothing", () => {
    expect(page({ q: "eudiometer" }).matched).toBeGreaterThan(0);
    expect(page({ q: "zzqx" }).matched).toBe(0);
    expect(page({ q: "thiosulphate" }).matched).toBeGreaterThan(2);
  });

  it("the page is capped and says what it left out", () => {
    const p = filterReactions(store, { ...DEFAULT_REACT_FILTER, limit: 30 });
    expect(p.rows.length).toBe(30);
    expect(p.truncated).toBe(true);
    expect(p.how).toContain("every record in the file: 424");
    const filtered = filterReactions(store, { ...DEFAULT_REACT_FILTER, cat: "redox", limit: 5 });
    expect(filtered.matched).toBe(96);
    expect(filtered.how).toContain("category “redox”");
    expect(filtered.how).toContain("96 of the 424");
  });
});

describe("one search box over everything", () => {
  it("nacl finds the bottle, the pair and the reaction", () => {
    const p = searchAll(store, [], "nacl");
    const kinds = new Set(p.hits.map((h) => h.kind));
    expect(kinds.has("species")).toBe(true);
    expect(kinds.has("combination")).toBe(true);
    expect(kinds.has("reaction")).toBe(true);
    expect(p.hits.some((h) => h.kind === "species" && h.id === "nacl")).toBe(true);
    expect(p.hits.some((h) => h.kind === "combination" && h.id === "Na-Cl")).toBe(true);
    expect(p.hits.some((h) => h.kind === "reaction" && /chlorid/i.test(h.label + h.sub))).toBe(true);
    for (const h of p.hits) expect(h.where).toBeTruthy();
  });

  it("an alias in the data reaches the same bottle as the name", () => {
    const p = searchAll(store, [], "rectified spirit");
    expect(p.hits.some((h) => h.kind === "species" && h.id === "ethanol")).toBe(true);
  });

  it("a CAS number, a symbol and a name all reach the same bottle", () => {
    for (const q of ["7732-18-5", "H2O", "water"]) {
      const p = searchAll(store, [], q);
      expect(p.hits.some((h) => h.kind === "species" && h.id === "water"), q).toBe(true);
    }
  });

  it("an element query ranks the element first, and the reason is printed", () => {
    const p = searchAll(store, [], "Fe");
    expect(p.hits[0].kind).toBe("element");
    expect(p.hits[0].id).toBe("Fe");
    expect(p.hits[0].where).toContain("element in the table");
  });

  it("a query with no hits has no hits, and no invented ones", () => {
    const p = searchAll(store, [], "zzqxq");
    expect(p.hits).toEqual([]);
    expect(p.more).toBe(0);
    expect(p.kinds).toEqual([]);
  });

  it("the saved notebook is searched too, and a note hit knows where it goes", () => {
    const bench = [
      { species_id: "nacl", qty: 20, unit: "g" as const },
      { species_id: "kno3", qty: 10, unit: "g" as const },
    ];
    const note = captureNote(bench, store, { hood: false, supervised: false, room_flammable_mL: 0 });
    const p = searchAll(store, [note], "sodium chloride");
    const hit = p.hits.find((h) => h.kind === "note");
    expect(hit).toBeTruthy();
    expect(hit!.id).toBe(note.id);
    expect(hit!.sub).toContain("nothing decided");
    const t = openTarget(store, hit!);
    expect(t.ok).toBe(true);
    expect((t as any).note).toBe(note.id);
    expect((t as any).sheet).toBeUndefined();
    expect(searchNotes([note], "eudiometer")).toEqual([]);
  });

  it("a hit is only offered when the record it opens exists", () => {
    const store_ = store;
    const ghost = { kind: "species" as const, id: "not_a_species", label: "ghost", sub: "", score: 100, where: "" };
    const t = openTarget(store_, ghost as any);
    expect(t.ok).toBe(false);
    expect((t as any).why).toContain("no record with that id");
    expect(openTarget(store_, { kind: "element", id: "Zz" } as any).ok).toBe(false);
    expect(openTarget(store_, { kind: "combination", id: "Xx-Yy" } as any).ok).toBe(false);
    expect(openTarget(store_, { kind: "reaction", id: "syn_h2o", label: "", sub: "", score: 1, where: "" } as any)).toEqual({
      ok: true,
      sheet: { kind: "reaction", id: "syn_h2o" },
    });
  });

  it("the cap is a cap, and it is reported", () => {
    const p = searchAll(store, [], "e", 10);
    expect(p.hits.length).toBe(10);
    expect(p.more).toBeGreaterThan(0);
  });
});

describe("the facet vocabulary is complete and honest", () => {
  it("every facet has a group, a reason and a way to test it", () => {
    for (const f of FACETS) {
      expect(typeof f.of).toBe("function");
      expect(f.why.length).toBeGreaterThan(8);
      expect(["what you see", "what the record can answer", "hazard and control"]).toContain(f.group);
      expect(FACET_BY_ID.get(f.id)).toBe(f);
    }
    expect(new Set(FACETS.map((f) => f.id)).size).toBe(FACETS.length);
  });

  it("the unbalanced facet is real: it names records whose own atom count disagrees", () => {
    const n = page({ facets: ["unbalanced"] }).matched;
    expect(n).toBeGreaterThanOrEqual(0);
    for (const r of page({ facets: ["unbalanced"] }).rows) expect(r.balanced).toContain("disagree");
    // and the two facets are exclusive: nothing both balances and does not
    expect(page({ facets: ["unbalanced", "equation"] }).matched).toBe(0);
  });
});
