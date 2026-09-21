/** The electrochemistry engine, checked against the shipped records and against what a
 *  textbook says the answer should be. Two kinds of assertion live here: numbers the app must
 *  reproduce (Daniell's 1.104 V, the Na–Cl row's 68.8) and properties that must hold for every
 *  couple in the table (a half equation that balances, a cell that is never negative, a verdict
 *  that agrees with the shipped displacement series). */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildStore } from "../src/data/load.js";
import type { CombinationsDoc, WarehouseDoc } from "../src/data/types.js";
import { buildCell, cellGrid, displacementRows, fromBottles, halfCells, resolveSide, type HalfCell } from "../src/lib/cell.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const read = (f: string) => JSON.parse(gunzipSync(readFileSync(resolve(root, f))).toString("utf8"));

let store: ReturnType<typeof buildStore>;
beforeAll(() => {
  const comb = read("combinations.json.gz") as CombinationsDoc;
  store = buildStore(read("chemlab.json.gz") as WarehouseDoc, comb.combinations, null);
});

const get = (key: string): HalfCell => {
  const h = halfCells(store).find((x) => x.key === key);
  if (!h) throw new Error(`no couple ${key} in tables.e0`);
  return h;
};
const cell = (a: string, b: string, opts?: Parameters<typeof buildCell>[3]) => {
  const r = buildCell(store, a, b, opts);
  if ("gap" in r) throw new Error(`gap: ${r.gap}`);
  return r;
};
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

describe("the half cells", () => {
  it("reads all 87 rows and keeps the table's order of merit", () => {
    const all = halfCells(store);
    expect(all.length).toBe(87);
    expect(all.every((h) => isFinite(h.E0))).toBe(true);
    expect(all[0].E0).toBeGreaterThan(all[all.length - 1].E0);
    // fluorine, not permanganate, is the top row of this table
    expect(all[0].key).toBe("F2/F-");
  });

  it("counts the electrons off the atoms and charges, not off a rule of thumb", () => {
    expect(get("Zn2+/Zn").n).toBe(2);
    expect(get("Al3+/Al").n).toBe(3);
    expect(get("Na+/Na").n).toBe(1);
    expect(get("Fe3+/Fe2+").n).toBe(1);
    expect(get("Cu2+/Cu+").n).toBe(1);
    expect(get("MnO4-/Mn2+").n).toBe(5);
    expect(get("Cl2/Cl-").n).toBe(2);
    expect(get("2H+/H2").n).toBe(2);
    expect(get("ClO3-/Cl-").n).toBe(6);
    expect(get("Sn4+/Sn2+").n).toBe(2);
    expect(get("Co3+/Co2+").n).toBe(1);
    expect(get("O2/H2O").n).toBe(4);
    expect(get("S2O8^2-/SO4^2-").n).toBe(2);
  });

  it("writes the half equation a marker would copy off the board", () => {
    expect(flat(get("MnO4-/Mn2+").half_equation)).toBe("MnO₄⁻ + 8 H⁺ + 5 e⁻ -> Mn²⁺ + 4 H₂O");
    expect(flat(get("ClO3-/Cl-").half_equation)).toBe("ClO₃⁻ + 6 H⁺ + 6 e⁻ -> Cl⁻ + 3 H₂O");
    expect(flat(get("Hg22+/Hg").half_equation)).toBe("Hg₂²⁺ + 2 e⁻ -> 2 Hg");
    expect(flat(get("O2/OH- (base)").half_equation)).toBe("O₂ + 2 H₂O + 4 e⁻ -> 4 OH⁻");
    expect(flat(get("Zn2+/Zn").half_equation)).toBe("Zn²⁺ + 2 e⁻ -> Zn");
    expect(flat(get("2H+/H2").half_equation)).toBe("2 H⁺ + 2 e⁻ -> H₂");
  });

  it("refuses rather than guesses where the couple cannot be balanced", () => {
    const awkward = halfCells(store).filter((h) => h.n === null);
    // every refusal has to say why, and the why has to name the couple
    for (const h of awkward) {
      expect(h.n_how.length).toBeGreaterThan(10);
      expect(h.n).toBeNull();
    }
    // three quarters of the table is derivable; a handful of mixed-ligand rows is not
    expect(awkward.length).toBeLessThan(16);
    expect(awkward.length).toBeGreaterThan(0);
  });

  it("asks the shelf what a charge is instead of reading the digits", () => {
    const ions = (store.doc.species as any[]).filter((s) => s.kind === "aqueous_ion");
    expect(resolveSide(ions, "MnO4-").charge).toBe(-1); // the 4 is a count
    expect(resolveSide(ions, "Cu2+").charge).toBe(2); // here it is not
    expect(resolveSide(ions, "MnO4-").species_id).toBe("ion:MnO4(-1)");
    expect(resolveSide(ions, "Zn").charge).toBe(0);
    expect(resolveSide(ions, "Ag,Cl-").charge).toBe(-1);
  });

  it("balances every half equation it claims to balance", () => {
    const bad: string[] = [];
    for (const h of halfCells(store)) {
      if (h.n === null) continue;
      const left: Record<string, number> = { "e-": h.n };
      const right: Record<string, number> = {};
      const add = (to: Record<string, number>, atoms: Record<string, number>, k: number) => {
        for (const [el, v] of Object.entries(atoms)) to[el] = (to[el] ?? 0) + v * k;
      };
      add(left, h.ox.atoms, h.ox.coef);
      add(right, h.red.atoms, h.red.coef);
      if (h.prod_h < 0) left["H"] = (left["H"] ?? 0) + -h.prod_h;
      if (h.prod_h > 0) right["H"] = (right["H"] ?? 0) + h.prod_h;
      if (h.prod_oh > 0) {
        right["O"] = (right["O"] ?? 0) + h.prod_oh;
        right["H"] = (right["H"] ?? 0) + h.prod_oh;
        right["charge_extra"] = (right["charge_extra"] ?? 0) - h.prod_oh;
      }
      if (h.prod_h < 0) left["charge_extra"] = (left["charge_extra"] ?? 0) + -h.prod_h;
      if (h.prod_h2o > 0) {
        right["O"] = (right["O"] ?? 0) + h.prod_h2o;
        right["H"] = (right["H"] ?? 0) + 2 * h.prod_h2o;
      }
      if (h.prod_h2o < 0) {
        left["O"] = (left["O"] ?? 0) + -h.prod_h2o;
        left["H"] = (left["H"] ?? 0) + -2 * h.prod_h2o;
      }
      const zl = h.ox.charge * h.ox.coef + (left["charge_extra"] ?? 0) - h.n;
      const zr = h.red.charge * h.red.coef + (right["charge_extra"] ?? 0);
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].filter((k) => k !== "charge_extra" && k !== "e-");
      for (const k of keys) if ((left[k] ?? 0) !== (right[k] ?? 0)) bad.push(`${h.key}: ${k} ${left[k] ?? 0} vs ${right[k] ?? 0}`);
      if (zl !== zr) bad.push(`${h.key}: charge ${zl} vs ${zr}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("a cell built from two of them", () => {
  it("is the Daniell cell the book says", () => {
    const d = cell("Zn2+/Zn", "Cu2+/Cu");
    expect(d.E0_cell).toBeCloseTo(1.104, 3);
    expect(d.n).toBe(2);
    expect(flat(d.equation)).toBe("Zn + Cu²⁺ -> Zn²⁺ + Cu");
    expect(d.cell_notation).toBe("Zn | Zn²⁺ || Cu²⁺ | Cu");
    expect(d.logK).toBeCloseTo(37.3, 1);
    expect(d.dG_kJ).toBeCloseTo(-213.0, 1);
    expect(d.balanced).toBe(true);
    expect(d.flipped).toBe(false);
    expect(d.notes).toEqual([]);
    expect(d.Q).toBe(1);
    expect(d.E_cell).toBe(d.E0_cell);
  });

  it("names the anode even when it is picked second", () => {
    const d = cell("Cu2+/Cu", "Zn2+/Zn");
    expect(d.E0_cell).toBeCloseTo(1.104, 3);
    expect(d.flipped).toBe(true);
    expect(d.anode.key).toBe("Zn2+/Zn");
    expect(d.notes[0]).toContain("not a cell that runs");
  });

  it("prices the concentration you typed with the same slope the data quotes", () => {
    const slope = Number((store.doc.tables?.constants as any).nernst_slope_25C.value);
    expect(slope).toBeCloseTo(0.05916, 5);
    const plain = cell("Zn2+/Zn", "Cu2+/Cu");
    const d = cell("Zn2+/Zn", "Cu2+/Cu", { conc: { "Cu2+": 0.05, "Zn2+": 0.2 } });
    expect(d.Q).toBeCloseTo(4, 6);
    // E = E° − (0.05916/2)·log10(4)
    expect(d.E_cell).toBeCloseTo(plain.E0_cell - (slope / 2) * Math.log10(4), 6);
    expect(plain.E_cell).toBe(plain.E0_cell);
  });

  it("follows the pH when the couple has to move protons", () => {
    const acid = cell("MnO4-/Mn2+", "Zn2+/Zn");
    expect(acid.n).toBe(10); // 2 permanganate halves (5 e- each) against 5 zincs
    expect(acid.ph_shift).toBeLessThan(0); // protons are consumed by the reduction, so they are reactants
    const at_pH0 = cell("MnO4-/Mn2+", "Zn2+/Zn", { pH: 0 });
    const at_pH7 = cell("MnO4-/Mn2+", "Zn2+/Zn", { pH: 7 });
    expect(at_pH0.E_cell).toBeCloseTo(acid.E0_cell, 3);
    expect(at_pH7.E_cell!).toBeLessThan(at_pH0.E_cell!);
    // 8 H+ per half, 2 halves, n = 10: one pH unit is worth 0.05916 × 16/10
    const drop = (at_pH0.E_cell! - at_pH7.E_cell!) / 7;
    expect(drop).toBeCloseTo((0.05916 * 16) / 10, 3);
  });

  it("gives the Na–Cl row its own log K back", () => {
    const d = cell("Na+/Na", "Cl2/Cl-");
    expect(d.E0_cell).toBeCloseTo(4.068, 3);
    expect(d.n).toBe(2);
    expect(flat(d.equation)).toBe("2Na + Cl₂ -> 2Na⁺ + 2Cl⁻");
    expect(d.logK).toBeCloseTo(137.5, 0);
    expect(d.logK_per_e).toBeCloseTo(68.8, 1);
    expect(d.combo?.logK).toBe(68.8);
    expect(d.combo?.logK_agrees).toBe(true);
    expect(d.combo?.pair).toBe("Na-Cl");
  });

  it("refuses to invent n, and says which half is at fault", () => {
    const awkward = halfCells(store).find((h) => h.n === null && BARE(h))!;
    const d = cell(awkward.key, "Zn2+/Zn");
    expect(d.n).toBeNull();
    expect(d.logK).toBeNull();
    expect(d.dG_kJ).toBeNull();
    expect(d.E0_cell).not.toBe(0); // the potential is still a difference of two tabulated numbers
    expect(d.notes.join(" ")).toContain("electron count");
    expect(d.basis.join(" ")).toContain("are not printed");
  });
});

const BARE = (h: HalfCell) => !/H2O|H\+/.test(h.key);

describe("the whole table at once", () => {
  it("never prints a cell that runs backwards, and balances what it balances", () => {
    const all = halfCells(store).filter((h) => h.n !== null);
    const seen = new Map<string, { a: string; b: string }>();
    for (const a of all) {
      for (const b of all) {
        if (a.key === b.key) continue;
        const k = [a.key, b.key].sort().join("|");
        if (seen.has(k)) continue;
        seen.set(k, { a: a.key, b: b.key });
        const d = cell(a.key, b.key);
        if (d.E0_cell < 0) throw new Error(`${k} came out at ${d.E0_cell}`);
        if (d.E0_cell === 0 && !d.notes.join(" ").includes("no direction")) throw new Error(`${k}: a tie with no explanation`);
        if (d.balanced !== true) throw new Error(`${k} did not balance: ${d.equation}`);
        if (d.logK !== null && Math.sign(d.logK) !== Math.sign(d.E0_cell)) throw new Error(`${k}: log K and E disagree`);
      }
    }
    expect(seen.size).toBeGreaterThan(300);
  });
});

describe("the displacement series", () => {
  it("re-derives every verdict in the shipped table from the two E0 values", () => {
    const d = displacementRows(store);
    expect(d.rows.length).toBe(703);
    expect(d.checked).toBe(703);
    expect(d.agree).toBe(703);
    expect(d.disagree).toEqual([]);
    expect(d.sign_mismatch).toEqual([]);
  });

  it("replaces the shipped n=2 assumption with the n the halves actually give", () => {
    const d = displacementRows(store);
    const changed = d.logK_recomputed.filter((r) => r.n_mine !== 2);
    expect(changed.length).toBeGreaterThan(100);
    const al = d.logK_recomputed.find((r) => r.metal === "Al" && r.reduces === "Zn");
    expect(al?.n_mine).toBe(6); // two aluminiums give six electrons to three zincs, not two
    expect(al?.mine).toBeCloseTo((al!.stored ?? 0) * 3, 0); // the shipped row rounds its log K to 3 s.f.
    // and where the shipped row picked a couple the app cannot balance, the app declines to recompute
    const stuck = d.logK_recomputed.find((r) => r.metal === "Al" && r.reduces === "Cu");
    expect(stuck?.n_mine).toBeNull();
    // where n differs from the assumed 2 the shipped number is off by exactly that ratio
    const differs = d.logK_recomputed.filter((r) => r.mine !== null && r.stored !== null && r.n_mine !== null && Math.abs(r.mine - r.stored) > 0.2);
    expect(differs.length).toBeGreaterThan(100);
    // the shipped log K is rounded to 3 s.f., so only trust the ratio where that is not the whole error
    for (const r of differs.filter((x) => (x.stored ?? 0) > 10)) expect(r.mine! / r.stored!).toBeCloseTo(r.n_mine! / 2, 1);
    const shipped_note = (store.doc as any).derived.displacement.predictions[0].logK.note;
    expect(shipped_note).toContain("n is assumed 2");
  });

  it("answers no as well as yes", () => {
    const g2 = cellGrid(store);
    expect(g2.skipped).toEqual([]);
    expect(g2.electrodes.length).toBe(23);
    expect(g2.rows.length).toBe(g2.electrodes.length * (g2.electrodes.length - 1));
    const yes = g2.rows.filter((r) => r.spontaneous);
    // exactly half go, less the one pair the table lists twice (nickel, and nickel in a plating bath)
    const ties = g2.rows.filter((r) => Math.abs(r.E) < 1e-12).length;
    expect(ties).toBe(2);
    expect(yes.length).toBe((g2.rows.length - ties) / 2);
    const zn_cu = g2.rows.find((r) => r.strip_key === "Zn2+/Zn" && r.ion_key === "Cu2+/Cu")!;
    expect(zn_cu.E).toBeCloseTo(1.104, 3);
    expect(zn_cu.spontaneous).toBe(true);
    expect(zn_cu.ion).toBe("Cu²⁺");
    const cu_zn = g2.rows.find((r) => r.strip_key === "Cu2+/Cu" && r.ion_key === "Zn2+/Zn")!;
    expect(cu_zn.E).toBeCloseTo(-1.104, 3);
    expect(cu_zn.spontaneous).toBe(false);
    // antisymmetric, because a cell and its reverse are the same pair of beakers
    for (const r of g2.rows) {
      const back = g2.rows.find((x) => x.strip_key === r.ion_key && x.ion_key === r.strip_key);
      expect(back).toBeTruthy();
      expect(back!.E).toBeCloseTo(-r.E, 10);
      expect(back!.spontaneous).toBe(r.E < -1e-12); // a tie goes neither way, which is a result too
    }
    // every pair the app's grid says goes is in the shipped series too. The other direction does
    // not hold: the shipped table covers 37 "metals" including the halogens, and for some elements
    // it picked a different couple (CuCl/Cu for copper), so its 703 rows are a wider, looser set.
    const preds = (store.doc as any).derived.displacement.predictions as any[];
    const byPair = new Map(preds.map((p) => [`${p.metal}|${p.reduces}`, p]));
    const el = (x: string) => x.replace(/[^A-Za-z]/g, "");
    const pairs = new Map<string, (typeof yes)[number]>();
    for (const r of yes) {
      const k = `${el(r.strip)}|${el(r.ion)}`;
      if (k.split("|")[0] !== k.split("|")[1] && !pairs.has(k)) pairs.set(k, r);
    }
    // the shipped series has an opinion on every pair the app has one on, and exactly one row per
    // pair: 37 element electrodes, 703 rows, which is every combination once plus the 37 trivial ones
    const absent = [...pairs.keys()].filter((k) => !byPair.has(k) && !byPair.has(k.split("|").reverse().join("|")));
    expect(absent).toEqual([]);
    expect(pairs.size).toBeGreaterThan(100);
    expect(preds.length).toBe(703);
    // the rows that differ do so because that element has more than one couple in the table
    // (Hg2+/Hg against Hg22+/Hg, Cu2+/Cu against CuCl/Cu) and the two build the same pair from
    // different halves. The app names the couple it used, so the difference is visible.
    const other_couple = [...pairs.entries()].filter(([k, r]) => {
      const p = byPair.get(k) ?? byPair.get(k.split("|").reverse().join("|"));
      if (!p) return false;
      return p.basis?.reducing !== r.strip_key || p.basis?.reduced !== r.ion_key;
    });
    // and every one of those 96 is an element the table holds more than one strip couple for,
    // which is the only place a different-but-equally-defensible choice of half cell can bite
    const by_element = new Map<string, string[]>();
    for (const h of halfCells(store)) {
      // any row of the table that puts a strip of the element on the reduced end, soluble or not
      if (h.red.charge !== 0 || !/^[A-Z][a-z]?$/.test(h.red.name)) continue;
      const e = h.red.name;
      by_element.set(e, [...(by_element.get(e) ?? []), h.key]);
    }
    const multi = new Set([...by_element].filter(([, v]) => v.length > 1).map(([k]) => k));
    expect(multi.size).toBeGreaterThan(1);
    for (const [k] of other_couple) {
      const [a, b] = k.split("|");
      expect(multi.has(a) || multi.has(b)).toBe(true);
    }
    expect(other_couple.length).toBeGreaterThan(50);
    expect(multi.has("Cu") && multi.has("Fe") && multi.has("Hg")).toBe(true);
  });
});

describe("the bench as a source of concentrations", () => {
  it("turns bottles into the molarity the Nernst step wants", () => {
    const r = fromBottles([{ formula: "CuSO4", moles: 0.005, name: "copper(II) sulfate" }], 100, [{ species: "Cu2+", element: "Cu" }]);
    expect(r.conc["Cu2+"]).toBeCloseTo(0.05, 6);
    expect(r.lines[0]).toContain("5 mmol of Cu");
    expect(r.lines[0]).toContain("100 mL");
    const two = fromBottles(
      [
        { formula: "Fe2(SO4)3", moles: 0.001, name: "iron(III) sulfate" },
        { formula: "H2SO4", moles: 0.002, name: "sulfuric acid" },
      ],
      200,
      [{ species: "Fe3+", element: "Fe" }],
    );
    expect(two.conc["Fe3+"]).toBeCloseTo(0.01, 6); // 2 Fe per formula unit, in 0.2 L
    const dry = fromBottles([{ formula: "CuSO4", moles: 0.005 }], 0, [{ species: "Cu2+", element: "Cu" }]);
    expect(dry.unknown).toEqual(["Cu2+"]);
    void r.unknown;
  });
});
