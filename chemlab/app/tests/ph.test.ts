/** Prompt 8: pH from the pKa table, solved. The acceptance numbers in ROADMAP.md are
 *  0.1 M acetic = 2.88, the half-neutralisation point = pKa, and CaSO4 at 1e-3 M staying in
 *  solution while 0.1 M does not. */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildStore } from "../src/data/load.js";
import { bufferPH, classify, solutionPH, titrate, indicatorsFor, solveFree, waterProduct } from "../src/lib/ph.js";
import { molarMassFromFormula, parseFormula, groupCount } from "../src/lib/chem.js";
import type { CombinationsDoc, Store, WarehouseDoc } from "../src/data/types.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const read = (f: string) => JSON.parse(gunzipSync(readFileSync(resolve(root, f))).toString("utf8"));
const doc = read("chemlab.json.gz") as unknown as WarehouseDoc;
let store: Store;
beforeAll(() => {
  store = buildStore(doc, (read("combinations.json.gz") as CombinationsDoc).combinations, null);
});
const pH = (id: string, M: number) => {
  const r = solutionPH(store, id, M);
  if ("gap" in r) throw new Error(`gap: ${r.gap}`);
  return r;
};

describe("the formula reader", () => {
  it("counts atoms in the shapes the data actually uses", () => {
    expect(parseFormula("H2O")).toEqual({ H: 2, O: 1 });
    expect(parseFormula("CuSO4.5H2O")).toEqual({ Cu: 1, S: 1, H: 10, O: 9 });
    expect(parseFormula("Al2(SO4)3")).toEqual({ Al: 2, S: 3, O: 12 });
    expect(parseFormula("Ca(OH)2")).toEqual({ Ca: 1, O: 2, H: 2 });
    expect(parseFormula("(NH4)2SO4")).toEqual({ N: 2, H: 8, S: 1, O: 4 });
    expect(parseFormula("ClNa")).toEqual({ Cl: 1, Na: 1 }); // Hill order, as the records write it
    expect(parseFormula("glass wool")).toBeNull();
    expect(groupCount("Ca(OH)2", "OH")).toBe(2);
    expect(groupCount("Na2CO3", "CO3")).toBe(1);
  });

  it("re-derives every molar mass the warehouse ships, from the element records", () => {
    const weight = new Map((doc.elements as any[]).map((e) => [e.symbol, e.atomic_mass?.value ?? null]));
    let checked = 0;
    const off: string[] = [];
    for (const s of store.species) {
      const shipped = s.molar_mass?.value;
      const written = s.formula_written ?? s.formula;
      if (!shipped || !written) continue;
      const mine = molarMassFromFormula(written, (el) => weight.get(el) ?? null);
      if (mine === null) continue;
      checked++;
      if (Math.abs(mine - shipped) > 0.02) off.push(`${s.id}: ${mine} vs ${shipped}`);
    }
    expect(checked).toBeGreaterThan(400);
    expect(off).toEqual([]);
  });
});

describe("pH", () => {
  it("classifies by what the record says, not by the name", () => {
    const ac = classify(store, store.speciesById.get("aceticacid"))!;
    expect(ac.kind).toBe("acid");
    expect(ac.pKs).toEqual([4.76]);
    const carb = classify(store, store.species.find((x) => x.formula_written === "Na2CO3"))!;
    expect(carb.kind).toBe("base");
    expect(carb.per_unit).toBe(1); // one carbonate per formula unit, counted from the formula
    const lime = classify(store, store.species.find((x) => /Ca\(OH\)2/.test(x.formula_written ?? "")))!;
    expect(lime.per_unit).toBe(2); // and slaked lime carries two hydroxides
    expect(lime.kind).toBe("base");
    expect(classify(store, store.speciesById.get("nacl"))).toBeNull(); // common salt: nothing to say
  });

  it("0.1 M acetic acid is 2.88, and the shortcut is visibly worse", () => {
    const r = pH("aceticacid", 0.1);
    expect(r.pH.toFixed(2)).toBe("2.88");
    expect(r.solute.pKs[0]).toBeCloseTo(4.76, 2);
    expect(r.alpha).toBeLessThan(0.05); // only a few per cent dissociated
    expect(r.basis.join(" ")).toMatch(/sqrt\(Ka\*C\) shortcut would give pH 2\.88/); // quoted, with its own error
    expect(Math.abs(r.shortcut_pH! - r.pH)).toBeLessThan(0.05); // close here, and that is the point: it is not always
  });

  it("reproduces the kernel's 53 reference points at 0.1 mol/L", () => {
    const ref = (doc as any).derived.weak_acid_ph.entries as any[];
    expect(ref.length).toBeGreaterThan(50);
    const pka = (doc.tables as any).pka;
    const kw = waterProduct(store, 25).Kw;
    let worst = 0;
    let worst_id = "";
    for (const e of ref) {
      const row = pka[e.id];
      if (!row?.pKa_values?.length) continue;
      const h = solveFree(row.pKa_values, 0.1, 0, kw, "h");
      const mine = -Math.log10(h);
      const theirs = e.pH_at_0p1M?.value;
      if (typeof theirs !== "number") continue;
      const Ka1 = 10 ** -row.pKa_values[0];
      const off = Math.abs(mine - theirs);
      if (row.pKa_values.length > 1) {
        // the reference table solves the first proton only; the app keeps all of them, so it is
        // allowed to be MORE acidic than the kernel and never less
        expect(mine, e.id).toBeLessThan(theirs + 0.01);
        expect(mine, e.id).toBeGreaterThan(theirs - 0.6);
        continue;
      }
      // below Ka ~1e-9 the water term the kernel's quadratic drops is bigger than the acid,
      // so the two are entitled to disagree - and only there.
      if (Ka1 > 1e-9) {
        if (off > worst) {
          worst = off;
          worst_id = e.id;
        }
        expect(off, `${e.id}: app ${mine.toFixed(3)} vs kernel ${theirs}`).toBeLessThan(0.05);
      } else if (theirs < 6.9) {
        // still acidic: the water term is a rounding error and the two must agree
        expect(off, `${e.id}: app ${mine.toFixed(3)} vs kernel ${theirs}`).toBeLessThan(0.05);
      } else {
        // the kernel's quadratic walks past neutral here, which no acid solution does
        expect(mine, e.id).toBeLessThan(7.05);
        expect(theirs).toBeGreaterThan(6.9);
      }
    }
    expect(worst_id).toBeTruthy();
    expect(worst).toBeLessThan(0.05);
    // the ethanol row of the reference table says pH 8.45 for a solution of an acid, which is
    // the shortcut talking; pin it so nobody "fixes" the app by making it agree
    const ethanol = ref.find((e) => e.id === "C2H5OH");
    const eth = solutionPH(store, "ethanol", 0.1) as any;
    expect(ethanol.pH_at_0p1M.value).toBeCloseTo(8.45, 2);
    expect(eth.pH.toFixed(2)).toBe("7.00");
    expect(eth.trust.join(" ")).toMatch(/water term owns this answer/);
  });

  it("knows a strong acid from a big Ka, without being told which is which", () => {
    expect(pH("hcl", 0.1).pH.toFixed(2)).toBe("1.00"); // pKa -6.3 solves to full dissociation
    expect(pH("hcl", 0.01).pH.toFixed(2)).toBe("2.00");
    const dilute = pH("aceticacid", 1e-5);
    expect(dilute.pH.toFixed(2)).toBe("5.15"); // 93 % dissociated, so the shortcut is badly wrong
    expect(dilute.trust.join(" ")).toMatch(/sqrt\(Ka\*C\) shortcut is .*% out/);
    expect(dilute.alpha.toFixed(2)).toBe("0.71"); // three quarters of it has let go of its proton
    const near_water = pH("aceticacid", 1e-8);
    expect(near_water.pH).toBeGreaterThan(6.8); // and at that dilution it is really just water
    expect(near_water.trust.join(" ")).toMatch(/dominated by Kw|water term owns/);
  });

  it("salts: carbonate is basic, ammonium is acidic, common salt has nothing to say", () => {
    const s = store.species;
    const carb = s.find((x) => x.formula_written === "Na2CO3")!;
    const r = pH(carb.id, 0.1);
    expect(r.solute.kind).toBe("base");
    expect(r.pH).toBeGreaterThan(11.3);
    expect(r.pH).toBeLessThan(12);
    const ammon = s.find((x) => x.formula_written === "NH4Cl");
    if (ammon) {
      const a = pH(ammon.id, 0.1);
      expect(a.pH).toBeGreaterThan(4.5);
      expect(a.pH).toBeLessThan(5.6);
    }
    const nacl = store.speciesById.get("nacl")!;
    const g_ = solutionPH(store, nacl.id, 0.1);
    expect("gap" in g_ ? g_.gap : "").toMatch(/no business quoting a pH/); // not covered, and it says so
  });

  it("a group 1 hydroxide is strong because its record says so, and the solubility caps it", () => {
    const r = pH("naoh", 0.05);
    expect(r.solute.kind).toBe("base");
    expect(r.pH.toFixed(2)).toBe("12.70");
    expect(r.basis.join(" ")).toMatch(/fully dissociated/);
    expect(r.basis.join(" ")).toMatch(/111 g per 100 g water/);
  });

  it("buffers: equal parts is the pKa, and the capacity says what it is worth", () => {
    const acetate = store.species.find((x) => x.formula_written === "CH3COONa") ?? store.species.find((x) => /acetate/i.test(x.name));
    expect(acetate).toBeTruthy();
    const b = bufferPH(store, "aceticacid", acetate!.id, 0.1, 0.1);
    if ("gap" in b) throw new Error(b.gap);
    expect(b.pH.toFixed(2)).toBe("4.76");
    expect(b.hh_pH!).toBeCloseTo(b.pH, 2);
    expect(b.capacity_mol_per_L_per_pH!).toBeCloseTo(0.115, 3);
    expect(b.trustworthy).toBe(true);
    const tilted = bufferPH(store, "aceticacid", acetate!.id, 0.19, 0.01);
    if ("gap" in tilted) throw new Error(tilted.gap);
    expect(tilted.trustworthy).toBe(false);
    expect(tilted.notes.join(" ")).toMatch(/stops buffering/);
    expect(tilted.pH).toBeLessThan(3.9);
    // and the whole point of a buffer: adding acid barely moves it
    const before = b.pH;
    const after = bufferPH(store, "aceticacid", acetate!.id, 0.11, 0.09);
    if ("gap" in after) throw new Error(after.gap);
    expect(Math.abs(after.pH - before)).toBeLessThan(0.11);
  });

  it("titration: the half-way point is the pKa, the end point is at 25.00 mL", () => {
    const curve = titrate(store, { analyte_id: "aceticacid", analyte_M: 0.1, analyte_mL: 25, titrant_M: 0.1 });
    if ("gap" in curve) throw new Error(curve.gap);
    const eq = curve.equivalences[0];
    expect(eq.V_mL).toBeCloseTo(25, 2);
    expect(eq.pH).toBeGreaterThan(8.5); // the acetate it makes is basic - the reason the indicator matters
    expect(eq.pH).toBeLessThan(9.1);
    const half = curve.points.reduce((best, p) => (Math.abs(p.V_mL - 12.5) < Math.abs(best.V_mL - 12.5) ? p : best), curve.points[0]);
    expect(half.pH.toFixed(2)).toBe("4.76"); // pH = pKa at half-neutralisation, from the solver
    expect(curve.points.length).toBeGreaterThan(100);
    expect(curve.points.every((p) => isFinite(p.pH))).toBe(true);
    const mono = curve.points[0];
    expect(mono.pH.toFixed(2)).toBe("2.88"); // and it starts where the plain solution was
  });

  it("chooses the indicator from the jump, and prices the wrong choice", () => {
    const curve = titrate(store, { analyte_id: "aceticacid", analyte_M: 0.1, analyte_mL: 25, titrant_M: 0.1 }) as any;
    const fits = indicatorsFor(curve, store);
    expect(fits.length).toBeGreaterThan(4);
    const phen = fits.find((f) => /phenolphthalein/i.test(f.name))!;
    expect(phen).toBeTruthy();
    expect(phen.fits).toBe(true);
    expect(Math.abs(phen.error_mL!)).toBeLessThan(0.2);
    const mo = fits.find((f) => /methyl orange/i.test(f.name))!;
    expect(mo.fits).toBe(false);
    expect(mo.error_mL!).toBeLessThan(-0.2); // it turns early, before the equivalence point
    expect(mo.note).toMatch(/NOT for acetic acid/i); // the data's own warning, not one I wrote
    expect(Math.abs(mo.error_percent!)).toBeGreaterThan(0.5);
    // strong against strong: almost anything works, and the curve says so
    const strong = titrate(store, { analyte_id: "hcl", analyte_M: 0.1, analyte_mL: 25, titrant_M: 0.1 }) as any;
    const eq2 = strong.equivalences[0];
    expect(eq2.pH.toFixed(1)).toBe("7.0");
    expect(indicatorsFor(strong, store).filter((f: any) => f.fits).length).toBeGreaterThan(fits.filter((f: any) => f.fits).length);
  });

  it("refuses a curve the data cannot support, in the same voice as an answer", () => {
    const r = titrate(store, { analyte_id: "nacl", analyte_M: 0.1, analyte_mL: 25, titrant_M: 0.1 });
    expect("gap" in r).toBe(true);
    expect((r as any).gap).toMatch(/no acidity constant/);
  });

  it("moves with the temperature, because Kw does", () => {
    const cold = pH("aceticacid", 0.1); // recorded at 25 C by default
    const ten = solutionPH(store, "aceticacid", 0.1, { T_C: 10 }) as any;
    expect(ten.Kw.Kw).toBeLessThan(cold.Kw.Kw);
    expect(ten.pH).toBeGreaterThan(cold.pH); // less Kw at 10 C pushes neutral to a higher pH
    expect(ten.trust.join(" ")).toMatch(/neutral.*is pH/, );
  });
});
