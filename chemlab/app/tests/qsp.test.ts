/** Prompt 8, second half: precipitation at the volumes you actually mixed. The roadmap's check
 *  is "CaSO4 at 1e-3 M does not precipitate while at 0.1 M it does" - the same two bottles, the
 *  same rule, and the answer changes because concentration is what the equilibrium reads. */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildStore } from "../src/data/load.js";
import { precipCheck, rowFromMatrix, solubilityRows, type Contribution } from "../src/lib/qsp.js";
import { groupCount } from "../src/lib/chem.js";
import type { CombinationsDoc, Store, WarehouseDoc } from "../src/data/types.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const read = (f: string) => JSON.parse(gunzipSync(readFileSync(resolve(root, f))).toString("utf8"));
const doc = read("chemlab.json.gz") as unknown as WarehouseDoc;
let store: Store;
beforeAll(() => {
  store = buildStore(doc, (read("combinations.json.gz") as CombinationsDoc).combinations, null);
});
const ksp = (salt: string) => (doc.tables as any).ksp[salt].Ksp.value as number;
/** both ions at molarity M in the beaker as mixed - the volumes are already accounted for */
const pair = (ion_a: string, ion_b: string, M: number, mL = 100): Contribution[] => [
  { label: `salt of ${ion_a}`, ion: ion_a, moles: (M * mL) / 1000 },
  { label: `salt of ${ion_b}`, ion: ion_b, moles: (M * mL) / 1000 },
];

describe("Q against Ksp", () => {
  it("the roadmap case: 1e-3 M calcium sulphate stays clear, 0.1 M does not", () => {
    const dilute = precipCheck(store, "CaSO4", pair("Ca", "SO4", 1e-3), 100);
    expect(dilute.verdict).toBe("nothing");
    expect(dilute.Q).toBeCloseTo(1e-6, 12);
    expect(dilute.ratio!).toBeLessThan(1);
    const conc = precipCheck(store, "CaSO4", pair("Ca", "SO4", 0.1), 100);
    expect(conc.verdict).toBe("precipitate");
    expect(conc.ratio!).toBeCloseTo(0.01 / ksp("CaSO4"), 0);
    expect(conc.regime).toMatch(/not a borderline case/);
  });

  it("the Ksp it uses is the one in the table, quoted with its source", () => {
    const r = precipCheck(store, "CaSO4", pair("Ca", "SO4", 0.1), 100);
    expect(r.row!.Ksp).toBe(ksp("CaSO4"));
    expect(r.row!.source).toMatch(/CRC/);
    expect(r.basis.join(" ")).toMatch(/Ksp = .*for CaSO4, CRC/);
    expect(r.basis.join(" ")).toMatch(/from 10 mmol salt of Ca \+ 10 mmol salt of SO4 in 100 mL/);
  });

  it("the coefficients in the dissolution equation become exponents in Q", () => {
    const lead = precipCheck(store, "PbI2", [{ label: "Pb(NO3)2", ion: "Pb", moles: 1e-4 }, { label: "KI", ion: "I", moles: 1e-4 }], 100);
    const c = 1e-3; // 1e-4 mol in 100 mL
    expect(lead.Q).toBeCloseTo(c * c * c, 15);
    expect(lead.expression).toContain("]^2");
    expect(lead.row!.equation).toMatch(/PbI2 = Pb.*\+ 2I/);
    // and a 1:2 salt reaches saturation on a very different scale than a 1:1 one
    const chromate = precipCheck(store, "Ag2CrO4", [{ label: "AgNO3", ion: "Ag", moles: 1e-5 }, { label: "K2CrO4", ion: "CrO4", moles: 5e-6 }], 10);
    expect(chromate.Q).toBeCloseTo((1e-3) ** 2 * 5e-4, 12);
  });

  it("names the middle ground instead of pretending it is decided", () => {
    // half of Ksp for a 1:1 salt sits squarely in the "cannot tell" band
    const c = Math.sqrt(0.5 * ksp("AgCl"));
    const r = precipCheck(store, "AgCl", pair("Ag", "Cl", c), 100);
    expect(r.verdict).toBe("marginal");
    expect(r.ratio!).toBeCloseTo(0.5, 3);
    expect(r.regime).toMatch(/within a factor of ten below Ksp/);
  });

  it("says what stays dissolved, which is the part 'insoluble' hides", () => {
    const r = precipCheck(store, "AgCl", pair("Ag", "Cl", 0.05), 100);
    expect(r.verdict).toBe("precipitate");
    expect(r.precipitated_mol_per_L!).toBeGreaterThan(0.049);
    expect(r.completeness_percent!).toBeGreaterThan(99.9);
    expect(r.precipitated_g_per_L!).toBeGreaterThan(7); // ~7.2 g of AgCl per litre of the mixture
    const free = r.after!.find((a) => a.ion === "Ag")!.mol_per_L;
    expect(free).toBeCloseTo(Math.sqrt(ksp("AgCl")), 12);
    expect(r.notes.join(" ")).toMatch(/what "insoluble" actually means|is not zero/);
    expect(r.notes.join(" ")).toMatch(/gravimetric/);
  });

  it("answers the two questions the beaker actually poses", () => {
    // 1. will it clear if I add water?
    const strong = precipCheck(store, "CaSO4", pair("Ca", "SO4", 0.1), 100);
    expect(strong.water_to_add_mL!).toBeGreaterThan(500);
    const diluted = precipCheck(store, "CaSO4", pair("Ca", "SO4", 0.1), 100 + strong.water_to_add_mL!);
    expect(diluted.ratio!).toBeGreaterThan(0.95);
    expect(diluted.ratio!).toBeLessThan(1.05);
    // 2. how much more of this ion before it starts?
    const starting = precipCheck(store, "AgCl", [{ label: "NaCl", ion: "Cl", moles: 0.005 }, { label: "AgNO3", ion: "Ag", moles: 0 }], 500);
    expect(starting.verdict).toBe("nothing");
    expect(starting.more_ion_needed_mol!).toBeCloseTo((ksp("AgCl") / 0.01) * 0.5, 12);
  });

  it("refuses both ways when the data has nothing to say", () => {
    const unknown = precipCheck(store, "NaNO3", pair("Na", "NO3", 1), 100);
    expect(unknown.verdict).toBe("unknown");
    expect(unknown.gap).toMatch(/hole in the data, not a verdict/);
    const dry = precipCheck(store, "AgCl", pair("Ag", "Cl", 0.1), 0);
    expect(dry.gap).toMatch(/no volume/);
  });

  it("survives the shapes a caller can hand it", () => {
    expect(groupCount("Ca(OH)2", "")).toBeNull();
    expect(groupCount("", "OH")).toBeNull();
    // a matrix row with no Ksp is a gap, not a zero, and must not stall the caller
    const row = rowFromMatrix({ product: "NaNO3", cation: "Na+", anion: "NO3-", coefficients: [1, 1], basis: "solubility rule" });
    expect(row.row).toBeNull();
    expect(row.gap).toMatch(/no measured Ksp/);
    const withK = rowFromMatrix({
      product: "AgCl",
      cation: "Ag+",
      anion: "Cl-",
      coefficients: [1, 1],
      ksp: { value: 1.8e-10, source: "CRC", confidence: "high" },
      dissolution_equation: "AgCl = Ag+ + Cl-",
    });
    expect(withK.row!.ions.map((i) => i.formula)).toEqual(["Ag", "Cl"]);
    expect(withK.row!.Ksp).toBe(1.8e-10);
  });

  it("the solubility rows come from the shipped derived table, with its provenance", () => {
    const rows = solubilityRows(store);
    const derived = ((doc as any).derived.solubility.entries as any[]).filter((e) => e?.Ksp?.value).length;
    expect(rows.size).toBe(derived);
    expect(derived).toBeGreaterThan(70);
    const agcl = rows.get("AgCl")!;
    expect(agcl.molar_solubility_M).toBeCloseTo(Math.sqrt(ksp("AgCl")), 10); // the shipped value is rounded to 6 s.f.
    // 1.9 mg per litre: the number that makes AgCl "insoluble" and still leaves 1.3e-5 mol/L in the water
    expect(agcl.g_per_L!.toFixed(3)).toBe("1.923");
    expect(agcl.solid_species_id).toBe("agcl");
    expect(store.speciesById.get("agcl")!.molar_mass!.value).toBeCloseTo(143.32, 2);
  });
});
