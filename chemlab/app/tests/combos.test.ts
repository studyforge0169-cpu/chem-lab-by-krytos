/** The element-pair browser, over the shipped combinations file. Every number asserted here was read
 *  off the file by hand first: the point is that the app's counting matches the data's, not that it
 *  matches this test's guesses. */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildStore } from "../src/data/load.js";
import { comboAudit, DEFAULT_FILTER, emfChain, filterCombos, pairCells, rowModel, STATUS_MEANING, symbolsIn } from "../src/lib/combos.js";
import { elementElectrodes, halfCells } from "../src/lib/cell.js";
import { g } from "../src/lib/format.js";
import type { CombinationsDoc, Store, WarehouseDoc } from "../src/data/types.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const read = (f: string) => JSON.parse(gunzipSync(readFileSync(resolve(root, f))).toString("utf8"));

let store: Store;
let meta: any;

beforeAll(() => {
  const doc = read("chemlab.json.gz") as WarehouseDoc;
  const comb = read("combinations.json.gz") as CombinationsDoc;
  store = buildStore(doc, comb.combinations, null, comb.meta);
  meta = comb.meta;
});

const page = (over: Partial<ComboFilterInit> = {}) => filterCombos(store, { ...DEFAULT_FILTER, limit: 100_000, ...over });
type ComboFilterInit = typeof DEFAULT_FILTER;

describe("the file and the app count the same rows", () => {
  it("the header's own numbers match the rows it heads", () => {
    expect(meta.rows).toBe(9410);
    const a = comboAudit(store);
    expect(a.rows).toBe(9410);
    expect(a.byStatus).toEqual({ verified: 72, empirical: 3, predicted: 5789, none: 3546 });
    expect(a.byStatus.verified).toBe(meta.verified);
    expect(a.with_emf).toBe(meta.with_emf);
    expect(a.with_emf).toBe(156);
    expect(a.disagreements).toEqual([]);
    expect(store.combosMeta?.rows).toBe(9410);
  });

  it("the status counts the browser shows add up to the file", () => {
    const c = page().counts;
    expect(Object.values(c).reduce((s: number, x: number) => s + x, 0)).toBe(9410);
    expect(c).toEqual({ predicted: 5789, none: 3546, verified: 72, empirical: 3 });
    for (const w of Object.keys(c)) expect(STATUS_MEANING[w], `no meaning printed for status "${w}"`).toBeTruthy();
  });

  it("a row either points at a shelf record or says it does not", () => {
    const a = comboAudit(store);
    expect(a.pointing_at_a_species).toBe(75);
    expect(a.dead_links).toEqual([]);
    const missing: string[] = [];
    for (const c of store.combos) {
      if (c.status === "verified" && !c.species_id) missing.push(`${c.pair}: verified with no species record`);
      if (c.status === "none" && !c.why) missing.push(`${c.pair}: a none row with no reason`);
      if (c.status === "none" && c.formula) missing.push(`${c.pair}: a none row carrying a formula`);
    }
    expect(missing).toEqual([]);
  });

  it("an emf row carries the whole chain, not a lone number", () => {
    const emf = store.combos.filter((c) => c.predicted_emf);
    expect(emf.length).toBe(156);
    const holes: string[] = [];
    for (const c of emf) {
      if (typeof c.log_k?.value !== "number") holes.push(`${c.pair}: emf with no log K`);
      if (typeof c.delta_g_kJ_per_mol?.value !== "number") holes.push(`${c.pair}: emf with no ΔG`);
      if (!c.verdict) holes.push(`${c.pair}: an emf with no verdict`);
    }
    expect(holes).toEqual([]);
    expect(store.combos.filter((c) => c.status === "predicted" && !c.formula).length).toBe(0);
  });
});

describe("the Na-Cl row, read off the file", () => {
  const raw = () => store.combos.find((c) => c.pair === "Na-Cl")!;

  it("is a verified row about sodium chloride", () => {
    const c = raw();
    expect(c.formula).toBe("NaCl");
    expect(c.formula_hill).toBe("ClNa");
    expect(c.formula_reduced).toBe("ClNa");
    expect(c.states).toEqual([1, -1]);
    expect(c.status).toBe("verified");
    expect((c as any).name).toBe("Sodium chloride (common salt)");
    expect((c as any).state).toBe("s");
    expect(c.species_id).toBe("nacl");
    expect(c.reaction_ids).toEqual([]);
    expect((c as any).properties_available).toEqual(["props_bp", "props_den", "props_mp", "props_sol"]);
  });

  it("carries its provenance on every number", () => {
    const c = raw();
    expect(c.molar_mass).toMatchObject({ value: 58.44, units: "g/mol", confidence: "high", basis: "computed" });
    expect(c.electronegativity_difference).toMatchObject({ value: 2.23, units: "Pauling scale", confidence: "high" });
    expect(c.percent_ionic_character).toMatchObject({ value: 71.2, units: "%", confidence: "rule" });
    expect(String(c.percent_ionic_character?.note)).toContain("rule of thumb");
    expect(c.predicted_emf).toMatchObject({ value: 4.068, units: "V", confidence: "med" });
    expect((c.predicted_emf as any).couples).toEqual(["Na+/Na", "Cl2/Cl-"]);
    expect(c.log_k?.value).toBe(68.8);
    expect(String(c.log_k?.source)).toContain("n = 1 e- per formula unit");
    expect(c.delta_g_kJ_per_mol?.value).toBe(-392.5);
    expect(c.verdict).toBe("combination strongly favoured");
  });

  it("agrees with what the app derives from the same two couples", () => {
    const c = raw();
    const chain = emfChain(c);
    expect(chain.length).toBeGreaterThanOrEqual(4);
    expect(chain.some((s) => s.line.includes("4.068"))).toBe(true);
    expect(chain.some((s) => s.line.includes("verdict: combination strongly favoured"))).toBe(true);
    const cells = pairCells(store, [...c.elements], (c.predicted_emf as any).couples);
    expect(cells.length).toBe(1);
    expect(cells[0].from_row).toBe(true);
    expect(g(cells[0].E, 4)).toBe("4.068"); // the row rounds to three decimals, the app keeps four
    expect(Math.abs(cells[0].E - (c.predicted_emf as any).value)).toBeLessThan(0.001);
    expect(cells[0].a.key).toBe("Na+/Na");
    expect(cells[0].b.key).toBe("Cl2/Cl-");
    // the row's log K is per mole of electrons, which is why it is not the whole-cell figure
    expect(g(4.068 / 0.05916, 3)).toBe("68.8");
  });

  it("the model the list renders says the same thing", () => {
    const m = rowModel(store, raw());
    expect(m.pair).toBe("Na-Cl");
    expect(m.formula).toBe("NaCl");
    expect(m.status).toBe("verified");
    expect(m.mass).toContain("58.44");
    expect(m.dchi).toContain("2.23");
    expect(m.ionic).toContain("71.2");
    expect(m.emf).toContain("4.068");
    expect(m.logK).toContain("68.8");
    expect(m.species?.id).toBe("nacl");
    expect(m.species_name).toContain("Sodium chloride");
    expect(m.reaction_count).toBe(0);
    expect(m.raw).toBe(c_());
    function c_() {
      return raw();
    }
  });

  it("is what the browser finds however you type it", () => {
    for (const q of ["NaCl", "na cl", "Na-Cl", "sodium chloride", "ClNa", "Na Cl"]) {
      const p = page({ q });
      expect(p.matched, `query ${q} gave ${p.how}`).toBe(1);
      expect(p.rows[0].pair).toBe("Na-Cl");
    }
  });
});

describe("the browser's filter, sort and cap", () => {
  it("the status filter matches the counts on the buttons", () => {
    const a = comboAudit(store);
    for (const s of ["verified", "empirical", "predicted", "none"] as const) {
      const p = page({ status: s });
      expect(p.matched, s).toBe(a.byStatus[s]);
      expect(p.rows.every((r) => r.status === s)).toBe(true);
    }
    expect(page({ status: "all" }).matched).toBe(9410);
  });

  it("the emf and verdict filters keep only rows that have them", () => {
    expect(page({ hasEmf: true }).matched).toBe(156);
    expect(page({ hasEmf: true, status: "predicted" }).matched).toBeLessThan(156);
    expect(page({ hasVerdict: true }).matched).toBe(156);
    for (const r of page({ hasVerdict: true }).rows) expect(r.verdict).toBeTruthy();
  });

  it("a run of symbols narrows to an atom set, then to a pair, and says which", () => {
    expect(page({ q: "NaCl" }).matched).toBe(1);
    expect(page({ q: "H2O" }).matched).toBe(1);
    expect(page({ q: "zzz" }).matched).toBe(0);
    const cu = page({ q: "Cu" });
    expect(cu.matched).toBeGreaterThan(100);
    expect(cu.matched).toBeLessThan(9410);
    // three symbols cannot name a pair of elements, so it falls back and admits it
    const so4 = page({ q: "CuSO4" });
    expect(so4.how).toContain("no row is made of exactly");
    expect(so4.rows.every((r) => r.pair.startsWith("Cu-") || r.pair.endsWith("-Cu"))).toBe(true);
  });

  it("sorting puts the extremes where they belong and the unmeasurable last", () => {
    // the button's default is "low first", so the least favourable cell leads and the best is last
    const e = page({ hasEmf: true, sort: "emf" });
    expect(e.rows[0].raw.predicted_emf?.value).toBe(-1.905);
    expect(e.rows[e.rows.length - 1].raw.predicted_emf?.value).toBe(5.906);
    expect(page({ hasEmf: true, sort: "emf", desc: true }).rows[0].pair).toBe("Li-F");
    for (const k of ["mass", "ionic", "dchi"] as const) {
      const rows = page({ sort: k, hasEmf: false, status: "predicted", limit: 400 }).rows;
      const get = (r: any) =>
        k === "mass" ? r.raw.molar_mass?.value : k === "ionic" ? r.raw.percent_ionic_character?.value : r.raw.electronegativity_difference?.value;
      const bad: string[] = [];
      // ascending: each row has to be at or below the next, and the pairs that came in at the same
      // value are broken by pair name, which is the only order there is
      for (let i = 1; i < rows.length; i++) {
        const a = get(rows[i - 1]);
        const b = get(rows[i]);
        if (b < a - 1e-9) bad.push(`${rows[i - 1].pair} ${a} → ${rows[i].pair} ${b}`);
      }
      expect(bad, `${k} ascending`).toEqual([]);
    }
    const back = page({ sort: "mass", desc: true, status: "predicted", limit: 1 });
    expect(back.rows[0].raw.molar_mass?.value).toBeGreaterThan(200);
    // a none row has no numbers at all, so it cannot lead a numeric sort
    const m = page({ sort: "mass", status: "none" });
    expect(m.matched).toBe(3546);
    expect(m.rows[0].mass).toBe("—");
  });

  it("the page is capped and says so", () => {
    const p = filterCombos(store, { ...DEFAULT_FILTER, limit: 60 });
    expect(p.rows.length).toBe(60);
    expect(p.truncated).toBe(true);
    expect(p.total).toBe(9410);
    expect(p.matched).toBe(9410);
    const small = filterCombos(store, { ...DEFAULT_FILTER, q: "NaCl", limit: 60 });
    expect(small.truncated).toBe(false);
    expect(small.total).toBe(9410);
  });
});

describe("what the browser will not do", () => {
  it("does not read symbols out of a display name", () => {
    expect(symbolsIn("NaCl", store)).toEqual(["Na", "Cl"]);
    expect(symbolsIn("CuSO4", store)).toEqual(["Cu", "S", "O"]);
    expect(symbolsIn("NaCl + H2O", store)).toEqual(["Na", "Cl", "H", "O"]);
    expect(symbolsIn("Na-Cl", store)).toEqual(["Na", "Cl"]);
    expect(symbolsIn("copper", store)).toEqual([]);
    expect(symbolsIn("chloride", store)).toEqual([]);
    expect(symbolsIn("", store)).toEqual([]);
  });

  it("shows a row with no formula as a row with no formula", () => {
    const c = store.combos.find((x) => x.status === "none")!;
    const m = rowModel(store, c);
    expect(m.formula).toBe("—");
    expect(m.states).toContain("no oxidation states");
    expect(m.mass).toBe("—");
    expect(m.dchi).toBe("—");
    expect(m.emf).toBeNull();
    expect(m.verdict).toBeNull();
    expect(m.why).toContain(String(c.why).slice(0, 20));
    expect(m.species).toBeFalsy();
  });

  it("refuses to claim a shelf record a row does not have", () => {
    const orphans = store.combos.filter((c) => c.species_id && !store.speciesById.has(c.species_id));
    expect(orphans.length).toBe(0);
    const pred = store.combos.find((c) => c.status === "predicted" && !c.species_id)!;
    expect(rowModel(store, pred).species).toBeFalsy();
  });

  it("lists every cell a pair could be instead of choosing one", () => {
    const cucl = store.combos.find((c) => c.pair === "Cu-Cl")!;
    const cells = pairCells(store, [...cucl.elements]);
    const copperCouples = elementElectrodes(store).filter((h) => /Cu/.test(h.red.name));
    expect(copperCouples.length).toBeGreaterThan(1);
    expect(cells.length).toBe(copperCouples.length * elementElectrodes(store).filter((h) => /Cl/.test(h.red.name)).length);
    for (const c of cells) expect(c.E).toBeGreaterThan(0);
    expect(pairCells(store, ["He", "Ne"])).toEqual([]);
    expect(pairCells(store, [])).toEqual([]);
  });

  it("knows which pairs have rows at all", () => {
    const syms = new Set(store.combos.flatMap((c) => [...c.elements]));
    expect(syms.size).toBe(118);
    // 9410 rows over 6903 pairs: a pair with several oxidation-state choices is several rows
    expect(new Set(store.combos.map((c) => c.pair)).size).toBe(6903);
    expect(store.combosByPair.get("B-Mn")!.length).toBe(6);
    expect(store.combosByPair.get("Mn-B")!.length).toBe(6);
    expect(page({ q: "MnB" }).matched).toBe(6);
    expect(new Set(page({ q: "MnB" }).rows.map((r) => r.formula)).size).toBeGreaterThan(1);
    expect(halfCells(store).length).toBeGreaterThan(80);
  });
});
