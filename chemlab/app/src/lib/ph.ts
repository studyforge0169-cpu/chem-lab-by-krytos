/** pH, buffers and titration curves, solved - not looked up from a table of answers.
 *
 *  The model is one equation, written once: for a solution holding a weak acid (or, mirrored,
 *  a weak base) at total concentration C together with a strong-ion spectator at Csalt,
 *
 *      h = Csalt + Kw/h + C * (sum over k of k * term_k) / D
 *      D = h^n + Ka1 h^(n-1) + Ka1 Ka2 h^(n-2) + ... + Ka1..Kan
 *
 *  which is the charge balance plus the mass balance plus every equilibrium constant, with no
 *  "x is small compared to C" step anywhere. The textbook shortcut sqrt(Ka*C) is still
 *  computed, but only so the screen can show how far off it is. */

import type { SpeciesRec, Store } from "../data/types.js";
import { groupCount } from "./chem.js";
import { g } from "./format.js";

const LOG10 = (x: number) => Math.log10 ? Math.log10(x) : Math.log(x) / Math.LN10;

export interface KwRec {
  Kw: number;
  pKw: number;
  T_C: number;
  source: string;
  confidence: string;
}

/** tables.kw is tabulated by whole degrees; Kw changes by a factor of 5 over the range, so
 *  interpolate in log space, which is where it is nearly linear. */
export function waterProduct(store: Store, T_C = 25): KwRec {
  const table = (store.doc.tables?.kw ?? {}) as Record<string, any>;
  const keys = Object.keys(table)
    .filter((k) => /^-?\d+(\.\d+)?$/.test(k))
    .map(Number)
    .sort((a, b) => a - b);
  const at = (c: number) => {
    const row = table[String(Math.round(c))];
    return row?.value ?? null;
  };
  let value = at(T_C);
  let source = value === null ? "no tabulated Kw at this temperature" : `tables.kw at ${Math.round(T_C)} °C`;
  let confidence = value === null ? "missing" : String(table[String(Math.round(T_C))]?.confidence ?? "high");
  if (value === null && keys.length) {
    const lo = keys.reduce((a, b) => (b <= T_C && b > a ? b : a), keys[0]);
    const hi = keys.reduce((a, b) => (b >= T_C && b < a ? b : a), keys[keys.length - 1]);
    const vl = at(lo), vh = at(hi);
    if (vl && vh && hi !== lo) {
      const t = (T_C - lo) / (hi - lo);
      value = 10 ** (LOG10(vl) * (1 - t) + LOG10(vh) * t);
      source = `interpolated in log space between tables.kw at ${lo} and ${hi} °C`;
      confidence = "approx";
    } else {
      value = vl ?? vh;
      source = `nearest tabulated value in tables.kw (${value === vl ? lo : hi} °C)`;
      confidence = "approx";
    }
  }
  if (!value) value = 1e-14;
  return { Kw: value, pKw: -LOG10(value), T_C, source, confidence };
}

export interface Solute {
  species_id: string;
  name: string;
  formula: string;
  kind: "acid" | "base";
  pKs: number[];
  source: string;
  confidence: string;
  note?: string;
  from: string;
  /** how many of the hydrolysing unit one formula unit delivers (Ca(OH)2 -> 2, Na2CO3 -> 1) */
  per_unit: number;
  /** a heavy group 2 hydroxide: strong, but only for the little that dissolves */
  capped_by_solubility?: boolean;
  /** the tabulated pK belongs to an ion, so the parent species must be counted in ions */
  ion_from_key?: string | null;
}

const firstNumber = (v: unknown): number | null =>
  typeof v === "number" && isFinite(v) ? v : null;

/** what this substance does to water, according to the records - never according to a name */
export function classify(store: Store, sp: SpeciesRec | undefined): Solute | null {
  if (!sp) return null;
  const written = sp.formula_written ?? sp.formula ?? sp.id;
  const kaRec = sp.props_ka as any;
  const kbRec = (sp as any).props_kb as any;
  const pka = (store.doc.tables?.pka ?? {}) as Record<string, any>;
  const pkb = (store.doc.tables?.pkb ?? {}) as Record<string, any>;

  const pick = (values: number[], kind: "acid" | "base", source: string, confidence: string, note?: string, from = "the species record") =>
    ({
      species_id: sp.id,
      name: sp.name,
      formula: written,
      kind,
      pKs: values,
      source,
      confidence,
      note,
      from,
      per_unit: 1,
    }) as Solute;

  if (kaRec?.values?.length)
    return pick(kaRec.values as number[], "acid", kaRec.source ?? "curated", String(kaRec.confidence ?? "high"), kaRec.note);
  if (kbRec?.values?.length)
    return pick(kbRec.values as number[], "base", kbRec.source ?? "curated", String(kbRec.confidence ?? "high"), kbRec.note);

  const tabAcid = pka[written] ?? pka[sp.formula ?? ""];
  if (tabAcid?.pKa_values?.length)
    return pick(tabAcid.pKa_values as number[], "acid", tabAcid.source ?? "tables.pka", String(tabAcid.confidence ?? "high"), tabAcid.note, "tables.pka");

  // salts: the table keys are written like "Na2CO3 (CO3^2-)" - the ion in brackets is the bit
  // that hydrolyses, and the count of it in the formula is what the concentration multiplies by
  for (const [key, row] of Object.entries(pkb)) {
    const head = key.split(" ")[0];
    const rec = row as any;
    if (head !== written) continue;
    const ion = (key.match(/\(([^)]+)\)/) ?? [])[1]?.replace(/\d+[-+]$/, "") ?? null;
    const value = firstNumber(rec?.value);
    if (value === null) continue;
    const per = ion ? groupCount(written, ion) ?? 1 : 1;
    return {
      ...pick([value], "base", rec.source ?? "tables.pkb", String(rec.confidence ?? "med"), rec.note, "tables.pkb"),
      per_unit: per,
      ion_from_key: ion,
    };
  }
  const saltAcid = pka[written];
  if (saltAcid?.pKa_values?.length) {
    const ion = (written.match(/\(([^)]+)\)/) ?? [])[1]?.replace(/\d+[-+]$/, "") ?? null;
    const per = ion ? groupCount(written, ion) ?? 1 : 1;
    return { ...pick(saltAcid.pKa_values as number[], "acid", saltAcid.source ?? "tables.pka", String(saltAcid.confidence ?? "high"), saltAcid.note, "tables.pka"), per_unit: per, ion_from_key: ion };
  }
  for (const [key, row] of Object.entries(pka)) {
    const head = key.split(" ")[0];
    const rec = row as any;
    if (head !== written || !rec?.pKa_values?.length) continue;
    const ion = (key.match(/\(([^)]+)\)/) ?? [])[1]?.replace(/\d+[-+]$/, "") ?? null;
    const per = ion ? groupCount(written, ion) ?? 1 : 1;
    return {
      ...pick(rec.pKa_values as number[], "acid", rec.source ?? "tables.pka", String(rec.confidence ?? "high"), rec.note, "tables.pka"),
      per_unit: per,
      ion_from_key: ion,
    };
  }

  // the hydroxides: a group-1 hydroxide is strong, and the record says how many OH it carries
  const oh = groupCount(written, "OH");
  if (oh && oh > 0 && sp.elements) {
    const metal = Object.keys(sp.elements as Record<string, number>).find((e) => e !== "O" && e !== "H") ?? "";
    const el = metal ? (store.doc.elements as any[])?.find((x) => x.symbol === metal) : null;
    if (!el) return null;
    const strong = el.group === 1 || (el.group === 2 && ["Ca", "Sr", "Ba"].includes(metal));
    if (strong)
      return {
        species_id: sp.id,
        name: sp.name,
        formula: written,
        kind: "base",
        pKs: [],
        source: "no pKb on the record: a group 1 (or heavy group 2) hydroxide is taken as fully dissociated",
        confidence: "high",
        note: `the ${oh} hydroxide${oh > 1 ? "s" : ""} per formula unit come from the formula, not from a table${el.group === 2 ? " — and for a heavy group 2 hydroxide only what dissolves counts, so the solubility on the record is the ceiling" : ""}`,
        from: `the element record's group ${el.group}`,
        capped_by_solubility: el.group === 2,
        per_unit: oh,
      };
  }
  return null;
}

/** The charge-and-mass balance for one weak species in water, solved for the free proton
 *  concentration (or, mirrored, the hydroxide one):
 *
 *      x + Csalt = Kw/x + C * (sum of k * term_k) / D
 *
 *  `x` is the thing being solved for, `C` the total analytical concentration of the weak
 *  species, `Csalt` the strong-ion spectator already in the beaker, `D` the usual sum of
 *  Ka-weighted terms. f is strictly increasing in x, so a bisection on log10(x) cannot miss
 *  the root, and there is no "assume x is small" step anywhere in this file. */
export function solveFree(
  pKs: number[],
  C: number,
  Csalt: number,
  Kw: number,
  variable: "h" | "oh",
): number {
  const Ks = pKs.map((p) => 10 ** -p);
  const n = Ks.length;
  const terms = (x: number): { D: number; num: number } => {
    if (!n) return { D: 1, num: 0 };
    let D = x ** n;
    let num = 0;
    let prod = 1;
    for (let k = 1; k <= n; k++) {
      prod *= Ks[k - 1];
      const t = prod * x ** (n - k);
      D += t;
      num += k * t;
    }
    return { D, num };
  };
  // free = water's own + what the weak species releases - what the spectator ion already carries
  // (for an acid the spectator is the Na+ that came with the acetate; for a base, the Cl-)
  const f = (x: number) => {
    const { D, num } = terms(x);
    return x + Csalt - Kw / x - (C * num) / D;
  };
  let lo = -22;
  let hi = 2;
  if (f(10 ** lo) > 0) return 10 ** lo;
  if (f(10 ** hi) < 0) return 10 ** hi;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(10 ** mid) > 0) hi = mid;
    else lo = mid;
  }
  void variable;
  return 10 ** ((lo + hi) / 2);
}

export interface PhResult {
  pH: number;
  pOH: number;
  h: number;
  oh: number;
  /** fraction of the weak species that has actually reacted with the water */
  alpha: number;
  shortcut_pH: number | null;
  shortcut_off: number | null;
  trust: string[];
  basis: string[];
  solute: Solute;
  molarity: number;
  Kw: KwRec;
}

/** pH of a plain solution of one substance at one concentration */
export function solutionPH(
  store: Store,
  species_id: string,
  molarity: number,
  opts: { T_C?: number; volume_mL?: number } = {},
): PhResult | { gap: string; species_id: string } {
  const sp = store.speciesById.get(species_id);
  const solute = classify(store, sp);
  if (!solute)
    return {
      gap: `neither the record nor tables.pka / tables.pkb carries an acidity constant for ${sp?.formula_written ?? species_id}, so the app has no business quoting a pH for it`,
      species_id,
    };
  const T_C = opts.T_C ?? 25;
  const kw = waterProduct(store, T_C);
  const C = molarity * solute.per_unit;
  if (!(C > 0)) return { gap: "no concentration given", species_id };
  const strong = solute.pKs.length === 0 || Math.abs(solute.pKs[0]) > 1.3 && solute.pKs[0] < 0;
  const pKs = strong && !solute.pKs.length ? [] : solute.pKs;
  let x: number;
  let basis: string[];
  if (!pKs.length) {
    // fully dissociated: the concentration IS the answer, capped by solubility if the record has one
    x = C;
    basis = [`${solute.formula} is taken as fully dissociated: ${g(C, 4)} mol/L of ${solute.kind === "base" ? "OH" : "H"}`];
    const sol = (sp as any)?.props_sol?.value;
    if (typeof sol === "number")
      basis.push(`its record says ${g(sol, 4)} g per 100 g water, so above about ${g(upperFromSolubility(sol, sp?.molar_mass?.value ?? null), 3)} mol/L you are looking at a suspension, not a solution`);
  } else {
    x = solveFree(pKs, C, 0, kw.Kw, solute.kind === "acid" ? "h" : "oh");
    basis = [`${pKs.length === 1 ? `pK${solute.kind === "acid" ? "a" : "b"} ${g(pKs[0], 4)}` : `pK values ${pKs.map((p) => g(p, 3)).join(", ")}`} from ${solute.from}${solute.source ? ` (${solute.source})` : ""}`];
    if (pKs.length > 1)
      basis.push(`${pKs.length} protons are tabulated and all of them are in the balance; the mean protonation is what sets the pH`);
  }
  const h = solute.kind === "acid" ? x : kw.Kw / x;
  const oh = solute.kind === "acid" ? kw.Kw / x : x;
  const pH = -LOG10(h);
  const trust: string[] = [];
  let shortcut_pH: number | null = null;
  let shortcut_off: number | null = null;
  if (pKs.length === 1 && solute.kind === "acid") {
    const Ka = 10 ** -pKs[0];
    const approx = Math.sqrt(Ka * C);
    shortcut_pH = -LOG10(approx);
    shortcut_off = (approx - h) / h;
    basis.push(
      shortcut_pH! > kw.pKw / 2
        ? `the sqrt(Ka*C) shortcut would answer pH ${g(shortcut_pH, 3)} — on the basic side of neutral, for a solution of an acid, because it never asks water's opinion. That is the shortcut failing, not the acid`
        : `the sqrt(Ka*C) shortcut would give pH ${g(shortcut_pH, 3)} — ${g(Math.abs(shortcut_off) * 100, 1)} % off on [H+]${Math.abs(shortcut_off) > 0.05 ? ", which is why this screen solves the balance instead" : " (close here, because only a few per cent of the acid has dissociated)"}`,
    );
    if (Math.abs(shortcut_off) > 0.05)
      trust.push(`the sqrt(Ka*C) shortcut is ${g(Math.abs(shortcut_off) * 100, 1)} % out on the hydrogen ion concentration here - which is why this screen solves the quadratic instead`);
    if (approx / C > 0.05) trust.push(`${g((approx / C) * 100, 1)} % of the acid has dissociated: past a few per cent the usual "x is small" step stops being true`);
  } else if (pKs.length === 1 && solute.kind === "base") {
    const Kb = 10 ** -pKs[0];
    const approx = Math.sqrt(Kb * C);
    shortcut_pH = kw.pKw + LOG10(approx);
    shortcut_off = (approx - oh) / oh;
    basis.push(`the sqrt(Kb*C) shortcut would give pH ${g(shortcut_pH, 3)} — ${g(Math.abs(shortcut_off) * 100, 1)} % off on [OH-]`);
    if (Math.abs(shortcut_off) > 0.05)
      trust.push(`the sqrt(Kb*C) shortcut is ${g(Math.abs(shortcut_off) * 100, 1)} % out on the hydroxide concentration here`);
  }
  const net = solute.kind === "acid" ? h - oh : oh - h; // what the solute itself contributed
  if (net < Math.sqrt(kw.Kw) / 2)
    trust.push(`the water term owns this answer: the ${solute.kind} shifts [H+] by only ${g(net, 2)} mol/L against the ${g(Math.sqrt(kw.Kw), 1)} mol/L pure water already has, so the pH is really a statement about Kw and not about ${solute.formula}`);
  if (solute.kind === "acid" && h < oh)
    trust.push(`the balance puts [OH-] above [H+] in a solution of an acid, which is only possible once the acid is weaker than water's own ionisation - the tabulated pKa is above pKw`);
  if (C < 1e-6) trust.push(`at ${g(C, 2)} mol/L the water's own ${g(Math.sqrt(kw.Kw), 1)} mol/L of H+ is the same size as the solute: the answer is dominated by Kw, not by this substance`);
  if (pH > kw.pKw - 1 || pH < 1) trust.push(`outside pH 1-13 the activity coefficients the data does not carry matter more than the constant does - read this as an order of magnitude`);
  if (T_C !== 25) trust.push(`"neutral" is pH ${g(kw.pKw / 2, 2)} at ${T_C} °C, not 7.00 - the pH scale moves with the temperature because Kw does`);
  // how much of the weak species has actually reacted with the water, read off the balance:
  // for an acid that is the anion it made, for a base the cation, either way the free ions minus
  // what the water itself supplies.
  const alpha = pKs.length ? Math.max(0, Math.min(1, (solute.kind === "acid" ? h - oh : oh - h) / C)) : 1;
  return {
    pH,
    pOH: kw.pKw - pH,
    h,
    oh,
    alpha,
    shortcut_pH,
    shortcut_off,
    trust,
    basis,
    solute,
    molarity,
    Kw: kw,
  };
}

function upperFromSolubility(g_per_100g: number, molar_mass: number | null): number | null {
  if (!molar_mass) return null;
  // g per 100 g water, and ~100 g water is ~100 mL: moles per litre of the saturated solution
  return (g_per_100g * 10) / molar_mass;
}

/* ------------------------------------------------------------------ buffers */

export interface BufferResult {
  pH: number;
  hh_pH: number | null;
  ratio: number | null;
  capacity_mol_per_L_per_pH: number | null;
  /** how much strong acid or base one litre takes before the buffer is spent */
  span_mL_of_1M: { to_acid: number; to_base: number } | null;
  trustworthy: boolean;
  notes: string[];
  basis: string[];
}

/** a mixture of the weak acid and its conjugate base, both at a stated molarity */
export function bufferPH(
  store: Store,
  acid_species_id: string,
  conjugate_species_id: string,
  acid_M: number,
  base_M: number,
  opts: { T_C?: number } = {},
): BufferResult | { gap: string } {
  const kw = waterProduct(store, opts.T_C ?? 25);
  const acid = classify(store, store.speciesById.get(acid_species_id));
  const conj = classify(store, store.speciesById.get(conjugate_species_id));
  if (!acid?.pKs.length) return { gap: `no pKa is curated for ${store.speciesById.get(acid_species_id)?.formula_written ?? acid_species_id}, so a buffer of it cannot be calculated` };
  const Ka = 10 ** -acid.pKs[0];
  const C_T = acid_M + base_M;
  const h = solveFree(acid.pKs, C_T, base_M, kw.Kw, "h");
  const pH = -LOG10(h);
  const ratio = acid_M > 0 ? base_M / acid_M : null;
  const hh_pH = ratio && ratio > 0 ? -LOG10(Ka) + LOG10(ratio) : null;
  const a = (Ka * h) / (Ka + h) ** 2;
  const capacity = 2.303 * (C_T * a + h + kw.Kw / h);
  const notes: string[] = [];
  let trustworthy = true;
  if (ratio !== null && (ratio > 10 || ratio < 0.1)) {
    trustworthy = false;
    notes.push(`the two components are ${g(Math.max(ratio, 1 / ratio), 2)}:1 apart - outside pKa ± 1 a buffer stops buffering, and Henderson–Hasselbalch stops being a fair summary of the answer`);
  }
  if (C_T < 0.01) {
    trustworthy = false;
    notes.push(`only ${g(C_T * 1000, 2)} mmol/L of buffer: this holds a few drops of acid before the pH runs away from it`);
  }
  if (conj && conj.kind !== acid.kind)
    notes.push(`${conj.formula} is filed as a ${conj.kind} in the data and ${acid.formula} as an ${acid.kind}, which is the pair a buffer needs - the pH above comes from the acid's pKa and both concentrations`);
  const span = C_T > 0 ? { to_acid: (base_M / C_T) * C_T, to_base: acid_M } : null;
  return {
    pH,
    hh_pH,
    ratio,
    capacity_mol_per_L_per_pH: capacity,
    span_mL_of_1M: span ? { to_acid: (base_M / 1) * 1000, to_base: (acid_M / 1) * 1000 } : null,
    trustworthy,
    notes,
    basis: [
      `pKa ${g(acid.pKs[0], 4)} from ${acid.from}${acid.source ? `, ${acid.source}` : ""}`,
      `Kw ${kw.Kw.toExponential(2)} at ${kw.T_C} °C from tables.kw (${kw.source})`,
      `solved from the charge and mass balance, not from the Henderson–Hasselbalch shortcut - the two differ by ${hh_pH === null ? "—" : `${g(Math.abs(hh_pH - pH), 3)} pH units`} here`,
    ],
  };
}

/* ----------------------------------------------------------------- titration */

export interface CurvePoint {
  V_mL: number;
  pH: number;
  dV: number;
}

export interface Equivalence {
  V_mL: number;
  pH: number;
  which_proton: number;
  jump_from_pH: number;
  jump_to_pH: number;
}

export interface Titration {
  points: CurvePoint[];
  equivalences: Equivalence[];
  analyte: Solute;
  titrant: "strong_base" | "strong_acid";
  titrant_M: number;
  notes: string[];
  basis: string[];
}

/** titrate one solution against a strong one, point by point. The curve is generated from the
 *  same balance as `solutionPH`, so the half-way pH coming out equal to the pKa is a check on
 *  the solver rather than a fact the code was told. */
export function titrate(
  store: Store,
  opts: {
    analyte_id: string;
    analyte_M: number;
    analyte_mL: number;
    titrant?: "strong_base" | "strong_acid";
    titrant_M: number;
    T_C?: number;
    points?: number;
  },
): Titration | { gap: string } {
  const kw = waterProduct(store, opts.T_C ?? 25);
  const analyte = classify(store, store.speciesById.get(opts.analyte_id));
  if (!analyte) return { gap: `the data has no acidity constant for ${store.speciesById.get(opts.analyte_id)?.formula_written ?? opts.analyte_id}, so there is no curve to draw` };
  const titrant = opts.titrant ?? (analyte.kind === "acid" ? "strong_base" : "strong_acid");
  if (titrant === "strong_base" && analyte.kind === "base")
    return { gap: "a base cannot be titrated with a base - pick an acid analyte or use acid as the titrant" };
  if (titrant === "strong_acid" && analyte.kind === "acid")
    return { gap: "an acid cannot be titrated with an acid - pick a base analyte or use base as the titrant" };
  const n_protons = Math.max(1, analyte.pKs.length);
  const mol_analyte = (opts.analyte_mL / 1000) * opts.analyte_M * analyte.per_unit;
  // each proton costs one equivalent of titrant per mole of acid, so step k sits at k x V_eq
  const V_eq = (mol_analyte / opts.titrant_M) * 1000;
  if (!(V_eq > 0)) return { gap: "no equivalence volume: check the concentrations" };
  const total_steps = opts.points ?? 161;
  const V_max = V_eq * (n_protons + 0.6);
  const pKs = analyte.pKs.length ? analyte.pKs : [titrant === "strong_base" ? -99 : 99];
  const points: CurvePoint[] = [];
  const pHat = (V: number): number => {
    const Vtot = (opts.analyte_mL + V) / 1000;
    const mol_strong = (V / 1000) * opts.titrant_M;
    const C_T = mol_analyte / Vtot;
    // the spectator ion produced by the titrant is what the conjugate base concentration is
    // every mole of titrant leaves a mole of spectator ion behind, and past the equivalence
    // point that is exactly what pushes the pH through 7 - one equation, no special case
    const Csalt = mol_strong / Vtot;
    if (!analyte.pKs.length) {
      const net = C_T * Vtot - mol_strong; // mmol of strong acid left un-neutralised
      const x = net > 0 ? (net / Vtot + Math.sqrt((net / Vtot) ** 2 + 4 * kw.Kw)) / 2 : null;
      if (x !== null) return -LOG10(x);
      const oh = (-net / Vtot + Math.sqrt((net / Vtot) ** 2 + 4 * kw.Kw)) / 2;
      return kw.pKw + LOG10(oh);
    }
    const x = solveFree(pKs, C_T, Csalt, kw.Kw, analyte.kind === "acid" ? "h" : "oh");
    return analyte.kind === "acid" ? -LOG10(x) : kw.pKw + LOG10(x);
  };
  let prev = pHat(0);
  points.push({ V_mL: 0, pH: prev, dV: 0 });
  for (let i = 1; i < total_steps; i++) {
    const V = (V_max * i) / (total_steps - 1);
    const pH = pHat(V);
    points.push({ V_mL: V, pH, dV: V - (points[points.length - 1]?.V_mL ?? 0) });
    prev = pH;
  }
  const equivalences: Equivalence[] = [];
  for (let k = 1; k <= n_protons; k++) {
    const V = V_eq * k;
    const lo = pHat(V * 0.995);
    const hi = pHat(V * 1.005);
    equivalences.push({
      V_mL: V,
      pH: pHat(V),
      which_proton: k,
      jump_from_pH: Math.min(lo, hi),
      jump_to_pH: Math.max(lo, hi),
    });
  }
  const notes: string[] = [];
  if (n_protons > 1)
    notes.push(`${n_protons} protons are tabulated for this acid, so the curve has ${n_protons} steps - and only the first is sharp enough for an indicator to find on its own`);
  if (!analyte.pKs.length) notes.push("the analyte is a strong acid or base, so the curve is flat until near the equivalence point and the jump is enormous");
  return {
    points,
    equivalences,
    analyte,
    titrant,
    titrant_M: opts.titrant_M,
    notes,
    basis: [
      `${g(mol_analyte * 1000, 4)} mmol of analyte against ${opts.titrant_M} mol/L titrant: ${n_protons} equivalence point${n_protons > 1 ? "s" : ""} at ${equivalences.map((e) => `${g(e.V_mL, 4)} mL`).join(", ")}`,
      `every point is the same charge-and-mass balance as a plain solution, with the salt concentration set by how much titrant has been added`,
      `Kw ${kw.Kw.toExponential(2)} at ${kw.T_C} °C (${kw.source})`,
    ],
  };
}

export interface IndicatorFit {
  name: string;
  pH_low: number;
  pH_high: number;
  acid_hex?: string;
  base_hex?: string;
  acid_colour?: string;
  base_colour?: string;
  note?: string;
  fits: boolean;
  /** the volume at which this indicator actually turns, and the error that costs */
  end_V_mL: number | null;
  error_mL: number | null;
  error_percent: number | null;
  why: string;
}

/** which indicator the lab's own table offers for this curve's jump - and, for the ones that do
 *  not fit, how much volume the mistake would have cost */
export function indicatorsFor(curve: Titration, store: Store): IndicatorFit[] {
  const list = ((store.doc.lab?.indicators ?? []) as any[]).filter((x) => x?.pH_low != null && x?.pH_high != null);
  const eq = curve.equivalences[0];
  if (!eq) return [];
  return list.map((x) => {
    const lo = Number(x.pH_low), hi = Number(x.pH_high);
    const overlaps = hi >= eq.jump_from_pH && lo <= eq.jump_to_pH;
    const mid = (lo + hi) / 2;
    // the end point is where the curve actually crosses the middle of the transition range
    let end_V: number | null = null;
    for (let i = 1; i < curve.points.length; i++) {
      const a = curve.points[i - 1], b = curve.points[i];
      if ((a.pH - mid) * (b.pH - mid) <= 0 && b.pH !== a.pH) {
        end_V = a.V_mL + ((mid - a.pH) / (b.pH - a.pH)) * (b.V_mL - a.V_mL);
        break;
      }
    }
    const err = end_V === null ? null : end_V - eq.V_mL;
    return {
      name: x.name,
      pH_low: lo,
      pH_high: hi,
      acid_hex: x.acid_hex,
      base_hex: x.base_hex,
      acid_colour: x.acid_colour,
      base_colour: x.base_colour,
      note: x.note,
      fits: overlaps,
      end_V_mL: end_V,
      error_mL: err,
      error_percent: err === null ? null : (err / eq.V_mL) * 100,
      why: overlaps
        ? `its range straddles the vertical part of the curve (${g(eq.jump_from_pH, 2)}–${g(eq.jump_to_pH, 2)} pH)`
        : end_V === null
          ? `its whole range is off the curve, so it would never change colour at the end point`
          : `it turns at ${g(end_V, 4)} mL, which is ${g(Math.abs(err!), 3)} mL ${err! < 0 ? "before" : "after"} the equivalence volume`,
    };
  });
}
