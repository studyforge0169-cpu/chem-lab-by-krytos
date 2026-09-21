/** Prompt 6: the numbers under the verdict. Everything here is derived from the shipped
 *  records — the test's job is to catch the app inventing, rounding up, or quietly assuming. */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildStore } from "../src/data/load.js";
import { combineRelative, pickBalance, pickGlassware, reactionPlan, sigFigs, solutionFromSolid } from "../src/lib/stoich.js";
import { gasVolume, runHeat, solutionHeat, thermoLedger } from "../src/lib/heat.js";
import { toMoles } from "../src/lib/amounts.js";
import type { BenchItem } from "../src/state/app.js";
import type { CombinationsDoc, SpeciesRec, Store, WarehouseDoc } from "../src/data/types.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const read = (f: string) => JSON.parse(gunzipSync(readFileSync(resolve(root, f))).toString("utf8"));
const doc = read("chemlab.json.gz") as unknown as WarehouseDoc;
let store: Store;
beforeAll(() => {
  store = buildStore(doc, (read("combinations.json.gz") as CombinationsDoc).combinations, null);
});
const sp = (id: string): SpeciesRec | undefined => store.speciesById.get(id);
const it_ = (id: string, qty: number, unit: "g" | "mol" | "mL" = "g"): BenchItem => ({ species_id: id, qty, unit });
const grams = (id: string, qty: number, unit: "g" | "mol" | "mL" = "g", molarity?: number) => {
  const item = { ...it_(id, qty, unit), ...(molarity ? { molarity } : {}) } as BenchItem;
  return { item, species: sp(id), moles: toMoles(item, sp(id), store.doc.lab?.stock_bottles ?? []) };
};

describe("quantities", () => {
  it("2 H2 + O2 -> 2 H2O: hydrogen is limiting and the water is the stoichiometric mass", () => {
    const rxn = store.reactionById.get("syn_h2o")!;
    expect(rxn).toBeTruthy();
    const plan = reactionPlan(rxn, [grams("h2gas", 4.032), grams("o2", 64)]);
    expect(plan.limiting).toEqual(["h2gas"]);
    expect(plan.extent_mol!).toBeCloseTo(1, 3);
    const water = plan.rows.find((r) => r.species_id === "water")!;
    expect(water.grams_yield!).toBeCloseTo(36.03, 2); // 2 x 18.015, the record's own molar masses
    expect(water.limiting).toBeFalsy();
    const ox = plan.rows.find((r) => r.species_id === "o2")!;
    expect(ox.left_mol!).toBeCloseTo(1, 3); // and it says so
  });

  it("percent yield only when a real number was typed, and never above 100 without a warning", () => {
    const rxn = store.reactionById.get("syn_h2o")!;
    const noActual = reactionPlan(rxn, [grams("h2gas", 4.032), grams("o2", 64)]);
    expect(noActual.percent).toBeNull();
    expect(noActual.actual_yield_g).toBeUndefined();
    const half = reactionPlan(rxn, [grams("h2gas", 4.032), grams("o2", 64)], 18.015);
    expect(half.percent!).toBeCloseTo(50, 1);
    const wet = reactionPlan(rxn, [grams("h2gas", 4.032), grams("o2", 64)], 40);
    expect(wet.percent!).toBeGreaterThan(100); // the screen explains it; the function does not hide it
  });

  it("says so when a quantity cannot become moles, instead of guessing a density", () => {
    const m = toMoles({ species_id: "sio2", qty: 10, unit: "mL" }, sp("sio2"), []);
    expect(m.moles).toBeNull();
    expect(m.basis).toBeTruthy();
    const rxn = store.reactionById.get("syn_h2o")!;
    const plan = reactionPlan(rxn, [
      grams("h2gas", 4.032),
      grams("o2", 10, "mL"),
    ]);
    expect(plan.extent_mol).toBeNull();
    expect(plan.notes.join(" ")).toMatch(/no amount could be turned into moles/);
    expect(plan.limiting).toEqual([]); // and no limiting reagent is named, because there is none we can prove
    expect(plan.rows.find((r) => r.species_id === "water")!.grams_yield).toBeNull();
  });

  it("counts a substance that is not in the equation instead of silently dropping it", () => {
    const rxn = store.reactionById.get("syn_h2o")!;
    const plan = reactionPlan(rxn, [grams("h2gas", 4.032), grams("o2", 64), grams("nacl", 5)]);
    expect(plan.notes.join(" ")).toMatch(/not in this equation/);
    expect(plan.extent_mol!).toBeCloseTo(1, 3);
  });

  it("quotes the balance, not the arithmetic: sig figs follow the instrument", () => {
    const ana = pickBalance(store, 1.461);
    expect(ana.name).toMatch(/analytical/i);
    expect(ana.readability_g).toBeCloseTo(0.001, 6);
    expect(ana.uncertainty_g).toBeCloseTo(0.002, 6); // tare + sample = two readings
    expect(ana.relative_percent!).toBeLessThan(0.2);
    expect(sigFigs(1.461, ana.relative_percent!)).toBe("1.46"); // 0.14 % buys three figures, not four
    // a tiny sample on the same balance is a much worse measurement than the number looks
    const tiny = pickBalance(store, 0.015);
    expect(tiny.relative_percent!).toBeGreaterThan(10);
    // one figure is all a 13 % measurement buys, and it is not even the figure you would round to
    expect(sigFigs(0.015, tiny.relative_percent!)).toBe("0.01");
    expect(pickBalance(store, 5000).note ?? "").toBeTruthy(); // over any capacity: still an answer
  });

  it("picks glassware by what it is for and reports the tolerance it carries", () => {
    const ten = pickGlassware(store, 10);
    expect(ten.name).toMatch(/pipette|burette/i);
    expect(ten.capacity_mL!).toBeGreaterThanOrEqual(10);
    expect(ten.relative_percent!).toBeLessThan(0.5);
    expect(pickGlassware(store, 250).id).toBe("volumetric_250"); // make-up glassware for making up
    expect(pickGlassware(store, 100).id).toBe("volumetric_100");
    expect(pickGlassware(store, 100).note).toMatch(/CONTAIN/i);
    const huge = pickGlassware(store, 5000);
    expect(huge.id).toBe("none");
    expect(huge.note).toMatch(/larger than the biggest/);
    const misuse = pickGlassware(store, 1);
    expect(misuse.relative_percent!).toBeGreaterThan(5); // 1 mL out of a 5 mL pipette
    expect(misuse.note).toMatch(/calibration point/);
  });

  it("combines independent errors in quadrature and says which term owns them", () => {
    const c = combineRelative([0.2, 0.2]);
    expect(c.sum!).toBeCloseTo(0.4, 6);
    expect(c.rss!).toBeCloseTo(0.283, 3);
    expect(c.worst!).toBeCloseTo(0.2, 6);
    expect(c.flag).toBeNull();
    expect(combineRelative([0.2, 20]).flag).toMatch(/one term owns this error/);
    const none = combineRelative([null, null]);
    expect(none.rss).toBeNull();
    expect(none.flag).toBeNull();
  });

  it("makes up a solution from a solid using the molar mass the app computed", () => {
    const s = solutionFromSolid(store, sp("nacl"), 250, 0.1)!;
    expect(s.moles).toBeCloseTo(0.025, 6);
    expect(s.molar_mass).toBeCloseTo(58.44, 3);
    expect(s.grams!).toBeCloseTo(1.461, 3);
    expect(s.flask.id).toBe("volumetric_250");
    expect(s.balance.name).toMatch(/analytical/i);
    expect(s.honest).toMatch(/balance/); // 0.14 % from the balance beats 0.016 % from the flask
    // the pentahydrate is the trap: the water is part of the mass
    const hydrated = store.species.find((x) => (x.formula_written ?? "") === "CuSO4.5H2O")!;
    expect(hydrated).toBeTruthy();
    const fromVitriol = solutionFromSolid(store, hydrated, 250, 0.1)!;
    expect(fromVitriol.grams!).toBeCloseTo(6.242, 2); // 249.677 x 0.025, not 159.61 x 0.025
    expect(solutionFromSolid(store, undefined, 250, 0.1)).toBeNull();
  });

  it("re-adds the enthalpy ledger and checks it against the record", () => {
    const l = thermoLedger(store.reactionById.get("syn_h2o")!);
    expect(l.terms.map((t) => t.token)).toEqual(["H2", "O2", "H2O"]);
    expect(l.incomplete).toBe(false);
    expect(l.sum_kJ).toBeCloseTo(-571.66, 2); // 0 + 0 - 2 x (-285.83), signed by side
    expect(l.agrees).toBe(true);
    // the elemental zeros are in the table now, so burning magnesium has a complete ledger
    const mg = thermoLedger(store.reactionById.get("syn_mgo")!);
    expect(mg.incomplete).toBe(false);
    expect(mg.terms.find((t) => t.token === "Mg")!.dHf).toBe(0);
    expect(mg.sum_kJ).toBeCloseTo(-1203.4, 1); // 2 x -601.7, per the equation as written
    expect(mg.cross!.comparison_basis).toMatch(/per mole of/); // and the build already knew the curated figure is per mole
    const hole = thermoLedger(store.reactionById.get("syn_hcl")!);
    expect(hole.incomplete).toBe(true);
    expect(hole.missing).toContain("NaHSO4");
    expect(hole.sum_kJ).toBeNull(); // it does not add up a ledger with a term missing
  });

  it("hand number: burning 1 g of magnesium, from the record's own numbers", () => {
    const rxn = store.reactionById.get("syn_mgo")!;
    const plan = reactionPlan(rxn, [grams("mg", 1), grams("o2", 32)]);
    const heat = runHeat(rxn, plan, store, 100);
    expect(heat.dH_kind).toBe("derived");
    expect(plan.extent_mol!).toBeCloseTo(1 / 24.305 / 2, 6);
    expect(heat.q_kJ!).toBeCloseTo(-24.76, 2); // -1203.4 kJ x 0.0205719 mol of equation
    expect(heat.dT_K!).toBeCloseTo(44.59, 2); // into 99.7 g of water plus the 33 g put in the beaker
    expect(heat.basis.join(" ")).toMatch(/re-added the per-term/);
  });

  it("uses a curated ΔH only when its basis cannot be misread", () => {
    const rxn = store.reactionById.get("ab_acoh_naoh")!; // ΔfH of CH3COONa is not curated
    const items = [grams("aceticacid", 6.004), grams("naoh", 4.0)];
    const plan = reactionPlan(rxn, items);
    const heat = runHeat(rxn, plan, store, 100);
    expect(heat.dH_kJ_per_extent).toBeCloseTo(-55.2, 3);
    expect(heat.dH_kind).toBe("curated");
    expect(heat.basis.join(" ")).toMatch(/Every coefficient here is 1/);
    expect(heat.q_kJ!).toBeCloseTo(-55.2 * plan.extent_mol!, 3);
    // the same record with a doubled coefficient must NOT be multiplied
    const dbl = JSON.parse(JSON.stringify(rxn));
    dbl.reactants[0].coefficient = 2;
    dbl.products[0].coefficient = 2;
    dbl.thermo_derived = { dH_rxn: { value: null } };
    const guarded = runHeat(dbl, reactionPlan(dbl, items), store, 100);
    expect(guarded.dH_kJ_per_extent).toBeNull();
    expect(guarded.q_kJ).toBeNull();
    expect(guarded.basis.join(" ")).toMatch(/not multiplied/);
  });

  it("hand number: the KNO3 cold pack gets to -13.8 K", () => {
    const moles = 10 / 101.102;
    const h = solutionHeat(store, "kno3", moles, 50);
    expect(h.dH_kJ_per_extent).toBeCloseTo(34.9, 3);
    expect(h.sign).toBe("endothermic");
    expect(h.q_kJ!).toBeCloseTo(3.452, 3);
    expect(h.mass_g).toBeCloseTo(59.85, 2);
    expect(h.dT_K!).toBeCloseTo(-13.78, 2); // 3452 J taken out of 59.85 g of solution
    expect(h.wording).toMatch(/13.8 K cooler/);
  });

  it("gas volumes come out of PV = nRT at a named convention, corrected for the water", () => {
    const dry = gasVolume(store, 0.25, { T_C: 25, overWater: false });
    expect(dry.molar_vol_L_mol).toBeCloseTo(24.465, 2); // 298.15 K at 1 atm, not the 1 bar shortcut
    expect(dry.V_L!).toBeCloseTo(0.25 * 24.465, 2);
    expect(dry.convention).toContain("25 °C");
    expect(dry.convention).toMatch(/PV = nRT/);
    expect(dry.convention).toMatch(/% away/);
    const bar = gasVolume(store, 1, { T_C: 25, P_kPa: 100 });
    expect(bar.molar_vol_L_mol).toBeCloseTo(24.789, 2);
    expect(bar.convention).toMatch(/SATP/);
    expect(bar.basis.join(" ")).toMatch(/textbook shortcut/);
    const wet = gasVolume(store, 0.25, { T_C: 25, overWater: true });
    expect(wet.water_kPa!).toBeGreaterThan(2);
    expect(wet.dry_P_kPa).toBeLessThan(101.325);
    expect(wet.V_L!).toBeGreaterThan(dry.V_L!);
    expect(wet.basis.join(" ")).toMatch(/vapour pressure/);
    const cold = gasVolume(store, 1, { T_C: 0 });
    expect(cold.molar_vol_L_mol).toBeCloseTo(22.414, 2); // 1 atm, so 22.4 is fair here
    expect(cold.basis.join(" ")).toMatch(/not 22.4|22\.71/);
    const he = gasVolume(store, 1, { T_C: 25, molar_mass: sp("h2gas")!.molar_mass!.value! });
    expect(he.vs_air!).toBeLessThan(0.1);
    expect(he.basis.join(" ")).toMatch(/0.79 N/);
  });

  it("heat: the record's own ΔH times the extent, and nothing when the record has none", () => {
    const rxn = store.reactionById.get("syn_h2o")!;
    const plan = reactionPlan(rxn, [grams("h2gas", 4.032), grams("o2", 64)]);
    const heat = runHeat(rxn, plan, store, 200);
    const dH = rxn.thermo_derived!.dH_rxn!.value!;
    expect(dH).toBeCloseTo(-571.66, 2);
    expect(heat.dH_kJ_per_extent).toBeCloseTo(dH, 4);
    expect(heat.q_kJ!).toBeCloseTo(dH * 1, 2);
    expect(heat.sign).toBe("exothermic");
    // 571.66 kJ into 200 g of water (plus what was weighed) is absurd - and the panel says so
    expect(heat.dT_K!).toBeGreaterThan(400); // 571.7 kJ into ~269 g: the beaker is a plasma
    expect(heat.basis.join(" ")).toMatch(/Cp of water/);
    expect(heat.basis.join(" ")).toMatch(/tables.water_density|nearest tabulated/);
  });

  it("never invents an enthalpy for a record whose ΔfH table has a hole in it", () => {
    const bare = (doc.reactions as any[]).find((r) => r.thermo_derived?.dH_rxn?.value == null && r.thermo_derived?.missing_terms?.length)!;
    expect(bare).toBeTruthy();
    const items = (bare.reactants ?? []).slice(0, 3).map((t: any) => grams(t.species_id ?? "h2gas", (t.coefficient || 1) * 10));
    const heat = runHeat(bare, reactionPlan(bare, items), store, 100);
    expect(heat.dH_kJ_per_extent).toBeNull();
    expect(heat.q_kJ).toBeNull();
    expect(heat.dT_K).toBeNull();
    expect(heat.sign).toBeNull();
    expect(heat.missing_terms!.length).toBeGreaterThan(0);
    expect(heat.missing_terms!.every((x) => typeof x === "string")).toBe(true);
    expect(heat.basis.join(" ")).toMatch(/does not estimate/);
  });

  it("dissolving: NaOH warms the beaker, NH4NO3 chills it, both from tables.dh_solution", () => {
    const h = solutionHeat(store, "naoh", 0.1, 200);
    const dh = (doc.tables as any).dh_solution.NaOH.value as number;
    expect(dh).toBeLessThan(0);
    expect(h.dH_kJ_per_extent).toBeCloseTo(dh, 4);
    expect(h.q_kJ!).toBeCloseTo(dh * 0.1, 4);
    expect(h.sign).toBe("exothermic");
    expect(h.dT_K!.toFixed(2)).toBe("5.23"); // 4450 J / (203.4 g x 4.184)
    expect(h.wording).toMatch(/warmer/);
    const chill = solutionHeat(store, store.species.find((x) => x.formula_written === "NH4NO3")!.id, 0.1, 200);
    expect(chill.sign).toBe("endothermic");
    expect(chill.dT_K!).toBeLessThan(0);
    expect(chill.wording).toMatch(/cooler/);
    const unknown = solutionHeat(store, "sio2", 0.1, 200);
    expect(unknown.dH_kJ_per_extent).toBeNull();
    expect(unknown.basis.join(" ")).toMatch(/gap in the data, not a zero/);
    expect(unknown.wording).toMatch(/cannot say/);
  });
});
