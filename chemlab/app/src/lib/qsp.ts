/** Will it actually cloud over, at the volumes in front of you?
 *
 *  The solubility rules on the shelf answer "is this salt soluble in water" - which is a
 *  statement about one saturated solution. What the bench asks is different: the ions are in a
 *  known number of millilitres at a known number of moles, so the ion product Q can be computed
 *  and compared with the tabulated Ksp. Both answers can be true at once, and this module's job
 *  is to say which regime you are in rather than to pick a winner. */

import type { Store } from "../data/types.js";
import { g } from "./format.js";

/** A matrix row carries its own Ksp, its coefficients and its molar mass, which is everything
 *  the ion product needs - so the bench never has to match a formula string against a table. */
export function rowFromMatrix(r: any): { row: SolubilityRow | null; gap?: string } {
  const Ksp = r?.ksp?.value ?? null;
  if (typeof Ksp !== "number")
    return { row: null, gap: `the ion-pair matrix has no measured Ksp for ${r?.product ?? "?"}, only ${r?.basis ? `a rule: ${r.basis}` : "nothing"}, so Q cannot be compared with anything` };
  const coeffs = (r.coefficients ?? [1, 1]) as number[];
  const base = (x: string) => String(x ?? "").replace(/\d*[+-]$/, "");
  return {
    row: {
      solid: r.product,
      solid_species_id: r.product_species_id ?? null,
      equation: r.dissolution_equation ?? `${r.product} = ${r.cation} + ${r.anion}`,
      ions: [
        { formula: base(r.cation), charge: Math.abs(Number(String(r.cation).match(/(\d*)[+-]$/)?.[1] ?? 1)) || 1, coefficient: coeffs[0] ?? 1 },
        { formula: base(r.anion), charge: Math.abs(Number(String(r.anion).match(/(\d*)[+-]$/)?.[1] ?? 1)) || 1, coefficient: coeffs[1] ?? 1 },
      ],
      Ksp,
      source: r.ksp.source ?? "the ion-pair matrix",
      confidence: String(r.ksp.confidence ?? "med"),
      molar_solubility_M: r.solubility_mol_L?.value ?? null,
      g_per_L: r.solubility_g_L?.value ?? null,
    },
  };
}

/** the molar mass of the solid, from the matrix row rather than from a species lookup */
export function solidMolarMass(r: any): number | null {
  const v = r?.molar_mass?.value;
  return typeof v === "number" ? v : null;
}

export interface SolubilityRow {
  solid: string;
  molar_mass?: number | null;
  solid_species_id: string | null;
  equation: string;
  ions: { formula: string; charge: number; coefficient: number }[];
  Ksp: number;
  source: string;
  confidence: string;
  molar_solubility_M: number | null;
  g_per_L: number | null;
}

export function solubilityRows(store: Store): Map<string, SolubilityRow> {
  const out = new Map<string, SolubilityRow>();
  const entries = ((store.doc as any).derived?.solubility?.entries ?? []) as any[];
  for (const e of entries) {
    if (!e?.solid || !e?.Ksp?.value) continue;
    out.set(e.solid, {
      solid: e.solid,
      solid_species_id: e.solid_species_id ?? null,
      equation: e.equation ?? "",
      ions: (e.ions ?? []).map((i: any) => ({ formula: i.formula, charge: i.charge ?? 0, coefficient: i.coefficient ?? 1 })),
      Ksp: e.Ksp.value,
      source: e.Ksp.source ?? "curated",
      confidence: String(e.Ksp.confidence ?? "high"),
      molar_solubility_M: e.molar_solubility_M?.value ?? null,
      g_per_L: e.g_per_L?.value ?? null,
    });
  }
  return out;
}

export interface Contribution {
  /** what is being poured in, for the words on the screen */
  label: string;
  /** moles of this particular ion arriving in the beaker */
  moles: number;
  /** which ion it is, as the solubility table names it ("Ca", "SO4") */
  ion: string;
  from_species_id?: string | null;
}

export type Verdict = "precipitate" | "marginal" | "nothing" | "unknown";

export interface Precipitation {
  row: SolubilityRow | null;
  Q: number | null;
  expression: string;
  concentrations: { ion: string; coefficient: number; mol_per_L: number }[];
  total_mL: number;
  ratio: number | null;
  verdict: Verdict;
  regime: string;
  /** after equilibrium: what stays dissolved, and what comes down */
  after: { ion: string; mol_per_L: number; fraction_left: number }[] | null;
  precipitated_mol_per_L: number | null;
  precipitated_g_per_L: number | null;
  completeness_percent: number | null;
  water_to_add_mL: number | null;
  more_ion_needed_mol: number | null;
  notes: string[];
  basis: string[];
  gap?: string;
}

/** Q = the product of the ion concentrations, each raised to how many the formula wants.
 *  Everything here is in moles and millilitres - the numbers the bench actually has. */
export function precipCheck(
  store: Store,
  salt: string,
  contributions: Contribution[],
  total_mL: number,
  rowOverride?: SolubilityRow | null,
): Precipitation {
  const rows = solubilityRows(store);
  const row = rowOverride ?? rows.get(salt) ?? null;
  const mm_override = rowOverride?.molar_mass ?? null;
  const L = total_mL / 1000;
  const mol_of = (ion: string) => contributions.filter((c) => c.ion === ion).reduce((a, c) => a + c.moles, 0);
  const concentrations = (row?.ions ?? []).map((i) => ({
    ion: i.formula,
    coefficient: i.coefficient,
    mol_per_L: L > 0 ? mol_of(i.formula) / L : 0,
  }));
  const expression = concentrations.map((c) => `[${c.ion}]${c.coefficient > 1 ? `^${c.coefficient}` : ""}`).join(" \u00d7 ");
  const empty: Precipitation = {
    row,
    Q: null,
    expression: "",
    concentrations,
    total_mL,
    ratio: null,
    verdict: "unknown",
    regime: "",
    after: null,
    precipitated_mol_per_L: null,
    precipitated_g_per_L: null,
    completeness_percent: null,
    water_to_add_mL: null,
    more_ion_needed_mol: null,
    notes: [],
    basis: [],
    gap: row ? undefined : `tables.ksp has no entry for ${salt}, so the app cannot say whether it precipitates - this is a hole in the data, not a verdict of "soluble"`,
  };
  if (!row) return empty;
  if (!(L > 0)) return { ...empty, gap: "no volume: Q needs concentrations, and a beaker of dry powder has no concentration to speak of" };
  let Q = 1;
  for (const c of concentrations) Q *= c.mol_per_L ** c.coefficient;
  const nu = concentrations.reduce((a, c) => a + c.coefficient, 0);
  const ratio = Q / row.Ksp;
  const basis = [
    `Ksp = ${row.Ksp.toExponential(2)} for ${row.solid}, ${row.source} (confidence: ${row.confidence})`,
    `Q = ${concentrations.map((c) => `(${g(c.mol_per_L, 3)})${c.coefficient > 1 ? `^${c.coefficient}` : ""}`).join(" × ")} = ${Q.toExponential(2)}, from ${contributions.map((c) => `${g(c.moles * 1000, 3)} mmol ${c.label}`).join(" + ")} in ${g(total_mL, 4)} mL`,
    `${row.equation || "the dissolution as written"} - the ion product is raised to the coefficients in that equation, which is why ${nu} concentrations are multiplied together`,
  ];
  const notes: string[] = [];
  let verdict: Verdict;
  let regime: string;
  if (ratio >= 100) {
    verdict = "precipitate";
    regime = `Q is ${g(ratio, 3)} times Ksp: this is not a borderline case, a cloud appears as you pour`;
  } else if (ratio > 1) {
    verdict = "precipitate";
    regime = `Q is ${g(ratio, 2)} times Ksp - oversaturated, but only just. A precipitate should form, and in practice it may need a scratch, a seed crystal or a minute of time: nucleation is the part the equilibrium does not describe`;
  } else if (ratio > 0.1) {
    verdict = "marginal";
    regime = `Q is within a factor of ten below Ksp: the tabulated constant is itself quoted to two figures, and at this distance the honest answer is "nothing visible, and nothing ruled out"`;
  } else {
    verdict = "nothing";
    regime = `Q is ${g(1 / ratio, 3)} times smaller than Ksp: the solution could hold ${g(1 / ratio, 2)} times more of each ion before anything comes down`;
  }
  // how much comes down: bisection on the extent of precipitation, which only ever lowers Q
  let xi = 0;
  const Qat = (x: number) => {
    let q = 1;
    for (const c of row.ions) {
      const free = Math.max(0, mol_of(c.formula) / L - c.coefficient * x);
      q *= free ** c.coefficient;
    }
    return q;
  };
  const max_x = Math.min(...row.ions.map((c) => mol_of(c.formula) / L / c.coefficient));
  if (ratio > 1 && max_x > 0) {
    let lo = 0;
    let hi = max_x;
    for (let i = 0; i < 120; i++) {
      const mid = (lo + hi) / 2;
      if (Qat(mid) > row.Ksp) lo = mid;
      else hi = mid;
    }
    xi = (lo + hi) / 2;
  }
  const after = row.ions.map((c) => {
    const free = Math.max(0, mol_of(c.formula) / L - c.coefficient * xi);
    const start = mol_of(c.formula) / L;
    return { ion: c.formula, mol_per_L: free, fraction_left: start > 0 ? free / start : 1 };
  });
  const limiting = row.ions.reduce((a, c) => (mol_of(c.formula) / c.coefficient < mol_of(a.formula) / a.coefficient ? c : a), row.ions[0]);
  const start_limiting = mol_of(limiting.formula) / L;
  const completeness = start_limiting > 0 ? (1 - (after.find((a) => a.ion === limiting.formula)?.mol_per_L ?? 0) / start_limiting) * 100 : null;
  const solid = store.speciesById.get(row.solid_species_id ?? "");
  const mm = mm_override ?? solid?.molar_mass?.value ?? null;
  if (xi > 0) {
    notes.push(`what stays in solution is not zero: ${g(after.find((a) => a.ion === limiting.formula)?.mol_per_L ?? 0, 3)} mol/L of the limiting ion, which is what "insoluble" actually means`);
    if (mm) notes.push(`that is ${g(xi * mm, 3)} g of ${solid?.name ?? row.solid} per litre - dry it and weigh it and this is a gravimetric determination`);
    else notes.push(`the mass that comes down cannot be quoted: neither the matrix row nor the shelf has a molar mass for ${row.solid}`);
  }
  // two questions a person in front of a beaker actually asks
  const water_to_add = ratio > 1 ? total_mL * (ratio ** (1 / nu) - 1) : null;
  if (water_to_add !== null && water_to_add > 0.01)
    notes.push(`diluting to ${g(total_mL + water_to_add, 4)} mL would just bring Q down to Ksp - the cloud redissolves at that volume and nowhere below it`);
  let more_ion_needed_mol: number | null = null;
  if (ratio < 1) {
    // how much of the ion you are adding would start the precipitation, keeping the others fixed
    const target = row.ions.find((c) => mol_of(c.formula) <= 0) ?? row.ions[row.ions.length - 1];
    if (target) {
      const others = row.ions.filter((c) => c !== target).reduce((a, c) => a * (mol_of(c.formula) / L) ** c.coefficient, 1);
      if (others > 0) {
        const need = (row.Ksp / others) ** (1 / target.coefficient);
        more_ion_needed_mol = Math.max(0, need * L - mol_of(target.formula));
        if (more_ion_needed_mol > 0)
          notes.push(`${g(more_ion_needed_mol * 1000, 3)} more mmol of ${target.formula} would start the precipitation - that is ${g((more_ion_needed_mol / Math.max(mol_of(target.formula) / L * L, 1e-12)) * 100, 2)} % of what is already in the beaker`);
      }
    }
  }
  return {
    row,
    Q,
    expression,
    concentrations,
    total_mL,
    ratio,
    verdict,
    regime,
    after: xi > 0 ? after : null,
    precipitated_mol_per_L: xi > 0 ? xi : null,
    precipitated_g_per_L: xi > 0 && mm ? xi * mm : null,
    completeness_percent: xi > 0 ? completeness : null,
    water_to_add_mL: water_to_add,
    more_ion_needed_mol,
    notes,
    basis,
  };
}
