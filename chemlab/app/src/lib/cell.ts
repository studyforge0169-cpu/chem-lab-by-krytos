/** Electrochemistry, from `tables.e0` and the species records - nothing else.
 *
 *  The half-cell table is 87 couple keys and a potential each. Everything the cell screen prints
 *  after that is derived here: which way round the cell runs, the balanced half equations, how
 *  many electrons cross, log K, ΔG, and what the voltage becomes when the beakers are not at
 *  standard state. A couple whose electrons cannot be balanced gets no n and no log K, and the
 *  screen says why: the house rule is that no number is invented and no shipped assumption -
 *  like the displacement table's "n = 2 for both halves" - is quietly copied. */

import type { Store } from "../data/types.js";
import { g, ionLabel } from "./format.js";
import { parseFormula, groupCount } from "./chem.js";

const LEAD = /^(\d+)\s*/;
/** a trailing "(base)", "(sat'd calomel)", "(plating bath, 25 C)" is a label, never part of a formula */
const QUAL = /\s*\(([^)]*)\)\s*$/;
const strip_qual = (s: string) => s.replace(QUAL, "");
export const qualifier_of = (s: string): string | null => {
  const m = s.match(QUAL);
  return m ? m[1].replace(/\s+/g, " ").trim() || null : null;
};
const CARET = /\^(\d*)([+-])$/;
const CHARGE_TAIL = /(\d*)([+-])$/;

/** one side of a couple key, read against the ion records on the shelf */
export interface Side {
  /** as written in the key, without a leading coefficient */
  text: string;
  /** the formula the app resolved it to ("MnO4"), with no charge on it */
  name: string;
  /** the same thing with its charge, spelled with a caret so no digit is ambiguous ("MnO4^-") */
  label: string;
  /** the same thing for a human: subscripts down, charge up ("MnO4⁻") */
  nice: string;
  /** charge per formula unit, from the species record when there is one */
  charge: number;
  from_record: boolean;
  species_id: string | null;
  atoms: Record<string, number>;
  /** more than one species on this side ("Ag,Cl-"), which is why the label needs brackets */
  parts: number;
  /** how many of these the half equation needs */
  coef: number;
}

export interface HalfCell {
  key: string;
  ox: Side;
  red: Side;
  /** "(base)" / "(acid)" on the key: the potential belongs to that medium */
  medium: string | null;
  /** which ion carries the hydrogen in this half equation, if either does */
  ph_partner: "H+" | "OH-" | null;
  /** signed coefficients on the PRODUCT side of the reduction: negative means it sits with the
   *  reactants. Everything the cell has to do with H+, OH- and water is arithmetic on these. */
  prod_h: number;
  prod_oh: number;
  prod_h2o: number;
  /** electrons per reaction as the couple must be written; null when it cannot be balanced */
  n: number | null;
  n_how: string;
  half_equation: string;
  E0: number;
  source: string;
  ref_id: string | null;
  confidence: string;
  units: string;
  note: string | null;
  elements: string[];
}

const ionsOf = (store: Store | null): any[] => (store ? (store.doc.species as any[]).filter((s) => s.kind === "aqueous_ion") : []);

const strip_lead = (s: string) => s.replace(LEAD, "").trim();

/** read `MnO4-`, `Cu2+`, `SO4^2-`, `Ag,Cl-`, `Zn` against the ion records.
 *  Two readings are possible for "MnO4-": the 4 is a charge or it is a count. The records settle
 *  it - whichever reading matches a species on the shelf wins, and the shelf has MnO4(-1). */
export function resolveSide(ions: any[], raw: string, inherit?: { name: string; atoms: Record<string, number> }): Side {
  const body0 = strip_qual(strip_lead(raw));
  // "[Co(NH3)6]3+/2+" is how the table abbreviates "…3+ / …2+": a bare charge with no formula
  // after the slash means the same species at that other charge.
  if (inherit && /^\d*[+-]$/.test(body0)) {
    const z = (Number(body0.slice(0, -1)) || 1) * (body0.endsWith("-") ? -1 : 1);
    const label = label_of(inherit.name, z);
    return { text: body0, name: inherit.name, label, nice: ionLabel(label), charge: z, from_record: false, species_id: null, atoms: { ...inherit.atoms }, parts: 1, coef: 1 };
  }
  const body = body0;
  const parts = body.split(",").map((p) => p.trim()).filter(Boolean);
  let charge = 0;
  let from_record = false;
  let species_id: string | null = null;
  const names: string[] = [];
  const labels: string[] = [];
  const atoms: Record<string, number> = {};
  for (const part of parts.length ? parts : [body]) {
    const caret = part.match(CARET);
    const tail = part.match(CHARGE_TAIL);
    const sign = part.endsWith("-") ? -1 : part.endsWith("+") ? 1 : 0;
    const cands: { name: string; z: number }[] = [];
    if (caret) {
      cands.push({ name: part.slice(0, caret.index), z: (caret[2] === "-" ? -1 : 1) * (caret[1] ? Number(caret[1]) : 1) });
    } else if (sign !== 0) {
      const digits = tail?.[1] ? Number(tail[1]) : 0;
      const with_digits = tail ? part.slice(0, tail.index) : part;
      cands.push({ name: with_digits, z: sign * (digits || 1) });
      if (digits) cands.push({ name: part.replace(/[+-]$/, ""), z: sign }); // the digits are a count, the charge is 1
      // "Hg22+" is how this table writes Hg2^2+: two of the element, two+ of charge. Nothing on
      // the shelf settles it, so the run of digits is split and both halves are kept small.
      if (digits >= 10 && digits % 10 !== 0)
        cands.push({ name: `${part.replace(/\d*\d[+-]$/, "").replace(/[+-]$/, "")}${Math.floor(digits / 10)}`, z: sign * (digits % 10) });
    } else {
      cands.push({ name: part, z: 0 });
    }
    let hit: any = null;
    let use = cands[0]!;
    for (const c of cands) {
      const want = c.name.replace(/\d*[+-]$/, "");
      hit = ions.find((s) => {
        const f = String(s.formula_written ?? "").trim();
        return (f === c.name || f === want) && Number(s.charge) === c.z;
      });
      if (hit) {
        use = c;
        break;
      }
      hit = null;
    }
    // nothing on the shelf: a single element keeps the table's own convention (Cu2+ is a 2+ ion),
    // a polyatomic one is read as a count with a unit charge, because a 3- or 4- oxyanion in this
    // table would have been written with a caret
    if (!hit && cands.length > 1) {
      // one element written with digits before the sign: the table's convention is that those
      // digits are the charge ("Co3+"). Two elements and no caret means a unit charge ("ClO3-"),
      // because this table writes every bigger charge with a caret ("SO4^2-").
      const bare_element = /^\[?[A-Z][a-z]?\d*[+-]$/.test(part);
      use = bare_element ? (Math.abs(cands[0]!.z) <= 7 ? cands[0]! : cands[cands.length - 1]!) : (cands.find((c) => Math.abs(c.z) === 1) ?? cands[1]!);
    }
    if (hit) {
      from_record = true;
      species_id = species_id ?? String(hit.id);
    }
    names.push(use.name);
    labels.push(label_of(use.name, use.z));
    charge += use.z;
    const a = parseFormula(use.name) ?? {};
    for (const [k, v] of Object.entries(a)) atoms[k] = (atoms[k] ?? 0) + (v as number);
  }
  const name = names.join(" + ");
  const label = parts.length > 1 ? `(${labels.join(" + ")})` : label_of(name, charge);
  const nice = parts.length > 1 ? `(${labels.map((x) => ionLabel(x)).join(" + ")})` : ionLabel(label);
  return { text: body, name, label, nice, charge, from_record, species_id, atoms, parts: parts.length || 1, coef: 1 };
}

/** "Cu" + 2 -> "Cu^2+", "MnO4" + -1 -> "MnO4^-". The caret is not decoration: without it
 *  "MnO4-" cannot be told apart from a charge of minus four, and the ion label would be wrong. */
export const label_of = (name: string, charge: number): string =>
  !charge ? name : `${name}^${Math.abs(charge) > 1 ? Math.abs(charge) : ""}${charge > 0 ? "+" : "-"}`;

const total = (s: Side) => ({ atoms: Object.fromEntries(Object.entries(s.atoms).map(([k, v]) => [k, v * s.coef])), charge: s.charge * s.coef });

/** The half equation this couple stands for, with the electron count that follows from it.
 *  Acid couples balance their spare oxygen with H+ and water, base-labelled ones with water and
 *  hydroxide; both are ordinary algebra on the atoms and charges the records carry. */
export function parseHalf(key: string, entry: any, store?: Store | null): HalfCell {
  const ions = ionsOf(store ?? null);
  const parts = String(key).split("/");
  const raw_ox = (parts[0] ?? "").trim();
  const raw_red = (parts[1] ?? "").trim();
  const qual = qualifier_of(raw_ox) ?? qualifier_of(raw_red);
  const medium = /\b(base|acid)\b/.exec(qual ?? "")?.[1] ?? null;
  const qualifier = qual && qual !== "base" && qual !== "acid" ? qual : null;
  const coef_ox = Number(raw_ox.match(LEAD)?.[1] ?? 1);
  const coef_red = Number(raw_red.match(LEAD)?.[1] ?? 1);
  const ox_resolved = resolveSide(ions, raw_ox);
  let ox = { ...ox_resolved, coef: coef_ox };
  let red = { ...resolveSide(ions, raw_red, ox_resolved), coef: coef_red };
  const A = total(ox);
  const B = total(red);
  const els = [...new Set([...Object.keys(A.atoms), ...Object.keys(B.atoms)])];

  // scale whichever side is short until every element except H and O matches
  let n: number | null = null;
  let n_how = "";
  let ph_partner: HalfCell["ph_partner"] = null;
  let prod_h = 0;
  let prod_oh = 0;
  let prod_h2o = 0;
  const core = els.filter((e) => e !== "H" && e !== "O");
  // Acid couples hand their spare oxygen to water and their spare charge to H+; a couple
  // tabulated in base does the same with water and OH-. Both readings are tried, and the
  // electrons are whatever is left over once the atoms and the charge are even.
  const attempt = (k_ox: number, k_red: number): { n: number; h: number; oh: number; w: number } | null => {
    const at: Record<string, number> = {};
    const bt: Record<string, number> = {};
    for (const e of Object.keys(A.atoms)) at[e] = (A.atoms[e] ?? 0) * k_ox;
    for (const e of Object.keys(B.atoms)) bt[e] = (B.atoms[e] ?? 0) * k_red;
    for (const e of core) if ((at[e] ?? 0) !== (bt[e] ?? 0)) return null;
    const za = A.charge * k_ox;
    const zb = B.charge * k_red;
    const dO = (at["O"] ?? 0) - (bt["O"] ?? 0);
    const dH = (bt["H"] ?? 0) - (at["H"] ?? 0);
    const acid_a = 2 * dO + dH; // H+ consumed
    const base_w = dH + dO; // H2O consumed
    const base_x = 2 * dO + dH; // OH- produced
    const acid = () => (acid_a >= 0 && za + acid_a - zb > 0 ? { n: za + acid_a - zb, h: -acid_a, oh: 0, w: dO } : null);
    const base = () => (base_w >= 0 && base_x >= 0 && za - zb + base_x > 0 ? { n: za - zb + base_x, h: 0, oh: base_x, w: -base_w } : null);
    // a couple tabulated in base is balanced with water and hydroxide first, because that is the
    // form its potential was measured in; an acid or unlabeled one takes the proton route
    return (medium === "base" ? base() ?? acid() : acid() ?? base());
  };
  const kmax = 3;
  for (let k = 1; k <= kmax && n === null; k++) {
    for (const [ko, kr] of k === 1 ? ([[1, 1]] as const) : ([[k, 1], [1, k]] as const)) {
      const r = attempt(ko, kr);
      if (!r) continue;
      n = r.n;
      ox = { ...ox, coef: coef_ox * ko };
      red = { ...red, coef: coef_red * kr };
      A.atoms = Object.fromEntries(Object.entries(A.atoms).map(([e, v]) => [e, v * ko]));
      B.atoms = Object.fromEntries(Object.entries(B.atoms).map(([e, v]) => [e, v * kr]));
      prod_h = r.h;
      prod_oh = r.oh;
      prod_h2o = r.w;
      ph_partner = r.h ? "H+" : r.oh ? "OH-" : null;
      const even = (v: number) => Math.abs(v);
      n_how = [
        `${ox.text} against ${red.text}${ko > 1 || kr > 1 ? `, scaled ${ko}:${kr} so the atoms of ${core.join(", ") || "the element"} match` : ""}`,
        r.h ? `${even(r.h)} H+ carries the hydrogen and ${even(r.w)} H2O the oxygen` : r.oh ? `${even(r.oh)} OH- and ${even(r.w)} H2O carry the hydrogen and oxygen` : "no hydrogen or oxygen changes hands",
        `which leaves ${n} electron${n === 1 ? "" : "s"} to even the charge: ${g(ox.charge * ox.coef, 3)} on the left becomes ${g(red.charge * red.coef, 3)} on the right`,
      ].join(", ");
      break;
    }
  }
  if (n === null && ox.name === red.name && ox.charge === red.charge) {
    n_how = `this row writes the same species on both sides of the slash, so there is no couple to balance - the table's own key is degenerate`;
  }
  if (n === null && !n_how) {
    const why = core.length && els.length > core.length
      ? `${ox.text} and ${red.text} do not have the same atoms of ${core.join(", ")}, and the spare cannot be handed to water and hydrogen ions in a way that balances the charge`
      : `the two sides of "${key}" cannot be turned into one balanced half equation from the atoms and charges on the shelf, so the electron count is unknown`;
    n_how = why;
  }
  const render = (m: Map<string, number>) =>
    [...m]
      .filter(([, k]) => k !== 0)
      .map(([label, k]) => `${k > 1 ? `${k} ` : ""}${label}`)
      .join(" + ");
  const half_equation = (() => {
    if (n === null) return `${ox.nice} + ? e⁻ -> ${red.nice} (unbalanced)`;
    const left = new Map<string, number>();
    const right = new Map<string, number>();
    const add = (m: Map<string, number>, label: string, k: number) => {
      if (!k) return;
      m.set(label, (m.get(label) ?? 0) + k);
    };
    add(left, ox.parts > 1 ? `(${ox.nice.replace(/^\(|\)$/g, "")})` : ox.nice, ox.coef);
    add(right, red.parts > 1 ? `(${red.nice.replace(/^\(|\)$/g, "")})` : red.nice, red.coef);
    if (prod_h) add(prod_h > 0 ? right : left, ionLabel("H^+"), Math.abs(prod_h));
    if (prod_oh) add(prod_oh > 0 ? right : left, ionLabel("OH^-"), Math.abs(prod_oh));
    if (prod_h2o) add(prod_h2o > 0 ? right : left, ionLabel("H2O"), Math.abs(prod_h2o));
    add(left, "e⁻", n);
    return `${render(left)} -> ${render(right)}`;
  })();

  return {
    key,
    ox,
    red,
    medium,
    ph_partner,
    prod_h,
    prod_oh,
    prod_h2o,
    n,
    n_how,
    half_equation,
    E0: Number(entry?.value),
    source: String(entry?.source ?? "tables.e0"),
    ref_id: entry?.ref_id ?? null,
    confidence: String(entry?.confidence ?? "high"),
    units: String(entry?.units ?? "V vs SHE at 25 C"),
    note: [entry?.note ?? null, qualifier].filter(Boolean).join("; ") || null,
    elements: els,
  };
}

const cache = new WeakMap<Store, HalfCell[]>();

/** The 87 rows are parsed once per store: every screen reads the same objects. */
export function halfCells(store: Store): HalfCell[] {
  const hit = cache.get(store);
  if (hit) return hit;
  const table = (store.doc.tables?.e0 ?? {}) as Record<string, any>;
  const ions = ionsOf(store);
  const out: HalfCell[] = [];
  for (const [key, entry] of Object.entries(table)) {
    const h = parseHalf(key, entry, ions.length ? store : null);
    if (isFinite(h.E0)) out.push(h);
  }
  out.sort((a, b) => b.E0 - a.E0);
  cache.set(store, out);
  return out;
}

export interface QTerm {
  species: string;
  /** the element whose moles set this ion's concentration; empty for H+ / OH- style partners */
  element: string;
  side: "product" | "reactant";
  exp: number;
  /** an ion in solution, a solid or liquid, or the solvent */
  kind: "ion" | "plain" | "solvent" | "ph" | "ph_base";
  /** what the app used: the typed value, 1 for a solid or the solvent, or 1 mol/L for standard state */
  value: number | null;
  given: boolean;
  species_id: string | null;
}

export interface CellResult {
  anode: HalfCell;
  cathode: HalfCell;
  /** the two were picked the wrong way round and the app flipped them */
  flipped: boolean;
  E0_cell: number;
  n: number | null;
  equation: string;
  cell_notation: string;
  logK: number | null;
  K: number | null;
  /** always printable: a decimal when the number exists, a power of ten when it does not */
  K_display: string;
  /** log K per mole of electrons, the convention the combination rows use */
  logK_per_e: number | null;
  dG_kJ: number | null;
  slope_V: number;
  Q: number | null;
  E_cell: number | null;
  q_terms: QTerm[];
  /** how many protons or hydroxides the cell moves per reaction: what makes it pH-sensitive */
  ph_shift: number;
  notes: string[];
  basis: string[];
  balanced: boolean;
  combo: {
    pair: string;
    formula: string;
    emf: number | null;
    logK: number | null;
    dG: number | null;
    verdict: string | null;
    status: string | null;
    logK_agrees: boolean | null;
    note: string;
  } | null;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const lcm = (a: number, b: number) => (a * b) / gcd(a, b);
const coef = (x: number) => (x === 1 ? "" : String(x));

/** `combinations.json` rows whose `predicted_emf` names these same two couples. Matched on the
 *  couple keys, never on a formula string, so a renamed compound cannot break the link. */
function comboFor(store: Store, anode: HalfCell, cathode: HalfCell, per_e: number): CellResult["combo"] {
  const want = [anode.key, cathode.key].sort().join("|");
  for (const r of (store.combos ?? []) as any[]) {
    const c = r?.predicted_emf?.couples as string[] | undefined;
    if (!c || c.length !== 2 || [...c].sort().join("|") !== want) continue;
    const row_logK = r?.log_k?.value ?? null;
    const agrees = row_logK === null ? null : Math.abs(Number(row_logK) - per_e) <= 0.051;
    return {
      pair: String(r.pair ?? ""),
      formula: String(r.formula ?? ""),
      emf: r?.predicted_emf?.value ?? null,
      logK: row_logK === null ? null : Number(row_logK),
      dG: r?.delta_g_kJ_per_mol?.value ?? null,
      verdict: r?.verdict ?? null,
      status: r?.status ?? null,
      logK_agrees: agrees,
      note:
        row_logK === null
          ? `the combination row for ${r.pair} carries no log K, so there is nothing here to compare with`
          : `the combination row for ${r.pair} carries ${row_logK} with n = 1 electron per formula unit; the same two potentials here give ${g(per_e, 4)}, ${agrees ? "which agrees" : `a difference of ${g(Math.abs(Number(row_logK) - per_e), 3)}`}`,
    };
  }
  return null;
}

/** The cell: which way it runs, what it is worth, and what the beakers do to it.
 *  `conc` is keyed on the species as the app names it ("Zn2+", "Cu2+", "H+"); anything absent is
 *  left at standard state, and a solid or the solvent is activity 1. */
export function buildCell(
  store: Store,
  left_key: string,
  right_key: string,
  opts: { conc?: Record<string, number>; T_C?: number; pH?: number | null } = {},
): CellResult | { gap: string } {
  const all = halfCells(store);
  const byKey = new Map(all.map((h) => [h.key, h]));
  const picked_a = byKey.get(left_key);
  const picked_b = byKey.get(right_key);
  if (!picked_a || !picked_b) return { gap: "both electrodes have to come from the half-cell table - pick them from the list" };
  if (picked_a.key === picked_b.key)
    return { gap: "the same couple on both sides is a concentration cell: the potentials cancel, and only a difference between the two beakers gives a voltage" };
  const flipped = picked_a.E0 > picked_b.E0;
  const cathode = flipped ? picked_a : picked_b;
  const anode = flipped ? picked_b : picked_a;
  const E0_cell = cathode.E0 - anode.E0;

  const consts = (store.doc.tables?.constants ?? {}) as Record<string, any>;
  const F = Number(consts.F?.value ?? consts.faraday_constant?.value ?? 96485.333);
  const slope25 = Number(consts.nernst_slope_25C?.value ?? 0.05916);
  const T_C = opts.T_C ?? 25;
  const slope = slope25 * ((T_C + 273.15) / 298.15);
  const kw_row = ((store.doc.tables?.kw ?? {}) as Record<string, any>);
  const kw_at = (t: number): number => {
    const r = kw_row[String(t)] ?? kw_row["25"] ?? kw_row[25];
    const v = Number(r?.value ?? 1e-14);
    return isFinite(v) && v > 0 ? v : 1e-14;
  };

  const notes: string[] = [];
  const basis: string[] = [
    `E°(cathode ${cathode.key}) = ${g(cathode.E0, 5)} V and E°(anode ${anode.key}) = ${g(anode.E0, 5)} V, both ${cathode.units}, from ${cathode.source}`,
    `E°cell = ${g(cathode.E0, 5)} − (${g(anode.E0, 5)}) = ${g(E0_cell, 5)} V — the more positive couple is the one that gets reduced, so that is the cathode`,
  ];
  if (Math.abs(E0_cell) < 1e-12)
    notes.push(`as tabulated these two potentials are the same, so the cell has no direction: nothing is spontaneous either way, and only the concentrations can break the tie`);
  if (flipped)
    notes.push(
      `picked the other way round, this cell reads ${g(-E0_cell, 4)} V, which is not a cell that runs: ${anode.key} is the anode. The pair has been flipped rather than printed with a minus`,
    );
  if (cathode.medium || anode.medium)
    notes.push(
      `${[cathode.medium === "base" ? cathode.key : null, anode.medium === "base" ? anode.key : null].filter(Boolean).join(" and ") || "one of these couples"} is tabulated for alkaline solution, so this emf belongs in that medium - the label is on the table row, and the pH field below is the way to leave it`,
    );

  const conc: Record<string, number> = { ...(opts.conc ?? {}) };
  if (opts.pH !== null && opts.pH !== undefined && isFinite(opts.pH)) {
    const h = 10 ** -opts.pH;
    conc["H^+"] = h;
    conc["OH^-"] = kw_at(T_C) / h;
    basis.push(`pH ${g(opts.pH, 4)}: [H+] = ${h.toExponential(2)} mol/L and [OH-] = Kw/[H+] = ${(kw_at(T_C) / h).toExponential(2)} mol/L, Kw from tables.kw at ${T_C} °C`);
  }

  const notation = `${anode.red.nice} | ${anode.ox.nice} || ${cathode.ox.nice} | ${cathode.red.nice}`;

  if (anode.n && cathode.n) {
    const n = lcm(anode.n, cathode.n);
    const ca = n / anode.n;
    const cc = n / cathode.n;
    // the anode runs its reduction backwards, so every term of it flips side
    // the anode runs backwards, so its product-side coefficients come off instead of being added
    const p_h = cc * cathode.prod_h - ca * anode.prod_h;
    const p_oh = cc * cathode.prod_oh - ca * anode.prod_oh;
    const p_w = cc * cathode.prod_h2o - ca * anode.prod_h2o;
    type Term = { name: string; label: string; nice: string; atoms: Record<string, number>; side: "product" | "reactant"; exp: number; kind: QTerm["kind"]; id: string | null; charge: number; element: string };
    const given_ = (name: string) => {
      const flat = name.replace(/[\s^]/g, "");
      for (const [k, v] of Object.entries(opts.conc ?? {})) if (k.replace(/[\s^]/g, "") === flat) return v;
      return undefined;
    };
    const one = (sid: Side, side: Term["side"], exp: number, kind: QTerm["kind"]): Term => ({
      name: sid.name,
      label: sid.label,
      nice: sid.nice,
      atoms: sid.atoms,
      side,
      exp,
      kind,
      id: sid.species_id,
      charge: sid.charge,
      element: first_el(sid.name),
    });
    const terms: Term[] = [
      one(anode.red, "reactant", ca * anode.red.coef, anode.red.charge ? "ion" : "plain"),
      one(cathode.ox, "reactant", cc * cathode.ox.coef, cathode.ox.charge ? "ion" : "plain"),
      one(anode.ox, "product", ca * anode.ox.coef, anode.ox.charge ? "ion" : "plain"),
      one(cathode.red, "product", cc * cathode.red.coef, cathode.red.charge ? "ion" : "plain"),
    ];
    if (p_h !== 0)
      terms.push({ name: "H", label: "H^+", nice: ionLabel("H^+"), atoms: { H: 1 }, side: p_h > 0 ? "product" : "reactant", exp: Math.abs(p_h), kind: "ph", id: null, charge: 1, element: "" });
    if (p_oh !== 0)
      terms.push({ name: "OH", label: "OH^-", nice: ionLabel("OH^-"), atoms: { O: 1, H: 1 }, side: p_oh > 0 ? "product" : "reactant", exp: Math.abs(p_oh), kind: "ph_base", id: null, charge: -1, element: "" });
    if (p_w !== 0)
      terms.push({ name: "H2O", label: "H2O", nice: ionLabel("H2O"), atoms: { H: 2, O: 1 }, side: p_w > 0 ? "product" : "reactant", exp: Math.abs(p_w), kind: "solvent", id: null, charge: 0, element: "" });
    const right_unused = null;
    void right_unused;
    // brackets only when something has to be multiplied into the whole side
    const shown = (t: Term) => `${coef(t.exp)}${t.exp > 1 ? t.nice : t.nice.replace(/^\((.*)\)$/, "$1")}`;
    const merged = new Map<string, Term>();
    for (const t of terms) {
      const hit = merged.get(`${t.label}|${t.side}`);
      if (hit) hit.exp += t.exp;
      else merged.set(`${t.label}|${t.side}`, { ...t });
    }
    const all_merged = [...merged.values()];
    const mL = all_merged.filter((t) => t.side === "reactant");
    const mR = all_merged.filter((t) => t.side === "product");
    const equation = `${mL.map(shown).join(" + ")} -> ${mR.map(shown).join(" + ")}`;
    const q_terms: QTerm[] = all_merged.map((t) => ({ species: t.label.replace(/^\((.*)\)$/, "$1"), element: t.element, side: t.side, exp: t.exp, kind: t.kind, value: null, given: false, species_id: t.id }));
    const nice_of = new Map(q_terms.map((t, i) => [t.species, terms[i]!.nice]));
    void nice_of;
    // the balance is checked, not assumed: atoms and charge on both sides
    const count = (list: Term[]) => {
      const out: Record<string, number> = {};
      for (const t of list) {
        for (const [el, v] of Object.entries(t.atoms)) out[el] = (out[el] ?? 0) + v * t.exp;
        out["@z"] = (out["@z"] ?? 0) + t.charge * t.exp;
      }
      return out;
    };
    const cl = count(mL);
    const cr = count(mR);
    const els_all = [...new Set([...Object.keys(cl), ...Object.keys(cr)])];
    const off = els_all.filter((e) => (cl[e] ?? 0) !== (cr[e] ?? 0));
    const balanced = off.length === 0;
    const dG_kJ = -(n * F * E0_cell) / 1000;
    const logK = (n * E0_cell) / slope;
    // a permanganate/zinc cell asks for 10^383, which no float holds. Printing Infinity is a lie
    // in the other direction, so print the exponent and let the screen say what it means.
    const K_raw = 10 ** logK;
    const K = Number.isFinite(K_raw) ? K_raw : null;
    const K_display = !Number.isFinite(K_raw)
      ? `10^${g(logK, 4)}`
      : K_raw >= 1e6 || K_raw < 1e-3
        ? K_raw.toExponential(2)
        : g(K_raw, 4);
    basis.push(
      `the anode half gives up ${anode.n} electrons and the cathode half takes ${cathode.n}, so ${ca} × (anode) and ${cc} × (cathode) cancels them at n = ${n}`,
    );
    basis.push(`anode: ${anode.half_equation} — ${anode.n_how}`);
    basis.push(`cathode: ${cathode.half_equation} — ${cathode.n_how}`);
    basis.push(
      balanced
        ? `the overall equation is balanced as written: the same atoms on both sides and ${g(cl["@z"] ?? 0, 3)} charge on each`
        : `THE CHECK FAILED: ${off.join(", ")} do not match across ${equation}`,
    );
    basis.push(
      `log K = nE°/${g(slope, 5)} = ${n} × ${g(E0_cell, 5)} / ${g(slope, 5)} = ${g(logK, 4)}, so K = ${K_display}; ΔG = −nFE° = ${g(dG_kJ, 4)} kJ per mole of reaction as written, with F = ${F} C/mol from tables.constants`,
    );
    let qv = 1;
    const seen: string[] = [];
    const defaults: Record<string, string> = {};
    if ((cathode.medium === "base" || anode.medium === "base") && conc["OH^-"] === undefined && conc["H^+"] === undefined) {
      conc["OH^-"] = 1;
      defaults["OH^-"] = "the table quotes this couple in base, so hydroxide at 1 mol/L is where its potential belongs and that is what the app uses";
    }
    for (const t of q_terms) {
      const given = conc[t.species] ?? given_(t.species);
      if (given !== undefined && given > 0) {
        if (defaults[t.species]) basis.push(`[${ionLabel(t.species)}] = 1 mol/L, ${defaults[t.species]}`);
        t.value = given;
        t.given = true;
        seen.push(t.species);
        qv *= t.side === "product" ? given ** t.exp : given ** -t.exp;
      } else {
        // nothing typed: a solid or the solvent is 1, and an ion at 1 mol/L is the very
        // standard state these potentials were measured against
        t.value = 1;
      }
    }
    const Q: number | null = qv;
    let E_cell = E0_cell;
    if (!seen.length) basis.push("no concentrations were given, so every ion in the equation stands at 1 mol/L — the standard state the tabulated potentials are quoted at — and Q is 1");
    if (Q > 0 && Q !== 1) {
      E_cell = E0_cell - (slope / n) * Math.log10(Q);
      const expr = (xs: QTerm[]) => xs.map((t) => `${t.value === null ? "?" : g(t.value, 3)}${t.exp > 1 ? `^${t.exp}` : ""}`).join(" × ") || "1";
      basis.push(
        `Nernst at ${T_C} °C: Q = (${expr(q_terms.filter((t) => t.side === "product"))}) / (${expr(q_terms.filter((t) => t.side === "reactant" && t.kind !== "solvent"))}) = ${g(Q, 3)} — a solid and the solvent count as 1 — and E = E° − (${g(slope, 5)}/${n})·log Q = ${g(E_cell, 4)} V`,
      );
    } else if (seen.length) {
      basis.push(`the concentrations given make Q exactly 1, so this cell sits on its standard voltage`);
    }
    const ph_total = p_h !== 0 ? p_h : p_oh;
    if (ph_total !== 0)
      notes.push(
        `this cell moves ${Math.abs(ph_total)} ${p_h !== 0 ? "H+" : "OH-"} per reaction, so its voltage depends on pH: ${ph_total < 0 ? "protons are a reactant, so the cell runs harder in acid" : p_h !== 0 ? "protons come off, so the cell runs harder in base" : "hydroxide comes off, so the cell runs harder in acid"}, and one pH unit is worth ${g((slope / n) * Math.abs(ph_total), 3)} V`,
      );
    return {
      anode,
      cathode,
      flipped,
      E0_cell,
      n,
      equation,
      cell_notation: notation,
      logK,
      K,
      K_display,
      logK_per_e: E0_cell / slope,
      dG_kJ,
      slope_V: slope,
      Q: Q !== null && Q > 0 ? Q : null,
      E_cell,
      q_terms,
      ph_shift: p_h !== 0 ? p_h : p_oh,
      notes,
      basis,
      balanced,
      combo: comboFor(store, anode, cathode, E0_cell / slope),
    };
  }

  notes.push(`the electron count could not be balanced: anode — ${anode.n_how}; cathode — ${cathode.n_how}`);
  const q_terms: QTerm[] = [
    { species: anode.red.label, element: first_el(anode.red.name), side: "reactant", exp: 1, kind: anode.red.charge ? "ion" : "plain", value: null, given: false, species_id: anode.red.species_id },
    { species: cathode.ox.label, element: first_el(cathode.ox.name), side: "reactant", exp: 1, kind: cathode.ox.charge ? "ion" : "plain", value: null, given: false, species_id: cathode.ox.species_id },
    { species: anode.ox.label, element: first_el(anode.ox.name), side: "product", exp: 1, kind: anode.ox.charge ? "ion" : "plain", value: null, given: false, species_id: anode.ox.species_id },
    { species: cathode.red.label, element: first_el(cathode.red.name), side: "product", exp: 1, kind: cathode.red.charge ? "ion" : "plain", value: null, given: false, species_id: cathode.red.species_id },
  ];
  return {
    anode,
    cathode,
    flipped,
    E0_cell,
    n: null,
    equation: `${anode.red.nice} + ${cathode.ox.nice} -> ${anode.ox.nice} + ${cathode.red.nice}, with no coefficients because the electron count is unknown`,
    cell_notation: notation,
    logK: null,
    K: null,
    K_display: "not printed",
    logK_per_e: E0_cell / slope,
    dG_kJ: null,
    slope_V: slope,
    Q: null,
    E_cell: E0_cell,
    q_terms,
    ph_shift: 0,
    notes,
    basis: [...basis, "E°cell is a difference of two tabulated potentials and needs no electron count. log K and ΔG do need it, so they are not printed"],
    balanced: false,
    combo: comboFor(store, anode, cathode, E0_cell / slope),
  };
}

const bare = (s: string) => s.replace(LEAD, "");
const first_el = (name: string): string => {
  const a = parseFormula(bare(name));
  if (!a) return "";
  const keys = Object.keys(a).filter((k) => k !== "H" && k !== "O");
  return (keys[0] ?? Object.keys(a)[0] ?? "").trim();
};

/** Concentrations for the Nernst step out of what is on the bench: the moles in each bottle times
 *  however many of that element the formula carries, over the volume the beaker was made up to.
 *  The same arithmetic the solubility card uses, so the two screens cannot disagree. */
export function fromBottles(
  bottles: { formula: string; moles: number; name?: string }[],
  total_mL: number,
  terms: { species: string; element: string }[],
): { conc: Record<string, number>; lines: string[]; unknown: string[] } {
  const L = total_mL / 1000;
  const conc: Record<string, number> = {};
  const lines: string[] = [];
  const unknown: string[] = [];
  for (const t of terms) {
    let mol = 0;
    const from: string[] = [];
    for (const b of bottles) {
      const k = b.formula && t.element ? groupCount(b.formula, t.element) ?? 0 : 0;
      if (k > 0 && b.moles > 0) {
        mol += b.moles * k;
        from.push(`${b.name ?? b.formula} (${k} per formula unit)`);
      }
    }
    if (L <= 0 || mol <= 0) {
      if (t.element) unknown.push(t.species);
      continue;
    }
    const c = mol / L;
    conc[t.species] = c;
    lines.push(`[${t.species}] = ${g(c, 3)} mol/L from ${g(mol * 1000, 3)} mmol of ${t.element} (${from.join(", ")}) made up to ${g(total_mL, 4)} mL`);
  }
  return { conc, lines, unknown: [...new Set(unknown)] };
}

/** The displacement grid: every element electrode against every other one's ion, both ways.
 *  The shipped series lists only what goes; a screen that cannot answer "no" is not a lab. */
export interface GridRow {
  strip: string;
  strip_key: string;
  ion: string;
  ion_key: string;
  E: number;
  n: number | null;
  logK: number | null;
  spontaneous: boolean;
  borderline: boolean;
  /** what the concentrations could do to this verdict, per tenfold change */
  slack_V: number;
}

const BARE_ELEMENT = /^[A-Z][a-z]?$/;

/** Couples of the form M^n+/M: a strip of one element sitting in a solution of its own ion.
 *  That is the shape a displacement question has. Reference electrodes (calomel, CuCl, AgCl)
 *  and the hydrogen gas electrode are real half cells but not strips, so they are not here. */
export function elementElectrodes(store: Store): HalfCell[] {
  return halfCells(store).filter((h) => {
    const el = h.red.name.replace(/\s+/g, "");
    if (!BARE_ELEMENT.test(el) || el === "H" || h.red.charge !== 0) return false;
    const keys = Object.keys(h.ox.atoms);
    return keys.length === 1 && keys[0] === el && h.ox.charge > 0;
  });
}

export function cellGrid(store: Store): { rows: GridRow[]; electrodes: HalfCell[]; skipped: { key: string; why: string }[] } {
  const slope = Number((store.doc.tables?.constants as any)?.nernst_slope_25C?.value ?? 0.05916);
  const electrodes = elementElectrodes(store);
  const skipped: { key: string; why: string }[] = [];
  for (const h of electrodes) if (h.n === null) skipped.push({ key: h.key, why: h.n_how });
  const rows: GridRow[] = [];
  for (const strip of electrodes) {
    for (const ion of electrodes) {
      if (strip.key === ion.key) continue;
      const E = ion.E0 - strip.E0;
      const n = strip.n && ion.n ? lcm(strip.n, ion.n) : null;
      rows.push({
        strip: strip.red.nice,
        strip_key: strip.key,
        ion: ion.ox.nice,
        ion_key: ion.key,
        E,
        n,
        logK: n ? (n * E) / slope : null,
        spontaneous: E > 0,
        borderline: Math.abs(E) < 0.05,
        slack_V: n ? (slope / n) * Math.max(strip.n ?? 1, ion.n ?? 1) : slope,
      });
    }
  }
  return { rows, electrodes, skipped };
}

/** Recheck the shipped displacement table against the two potentials its own row names. */
export function displacementRows(store: Store): {
  rows: any[];
  checked: number;
  agree: number;
  disagree: { metal: string; reduces: string; mine: number; stored: number | null }[];
  sign_mismatch: any[];
  uncheckable: number;
  logK_recomputed: { metal: string; reduces: string; n_assumed: number; n_mine: number | null; stored: number | null; mine: number | null }[];
} {
  const all = new Map(halfCells(store).map((h) => [h.key, h]));
  const preds = ((store.doc as any).derived?.displacement?.predictions ?? []) as any[];
  const disagree: { metal: string; reduces: string; mine: number; stored: number | null }[] = [];
  const sign_mismatch: any[] = [];
  const logK_recomputed: { metal: string; reduces: string; n_assumed: number; n_mine: number | null; stored: number | null; mine: number | null }[] = [];
  let agree = 0;
  let uncheckable = 0;
  for (const p of preds) {
    const emf = p?.emf_V?.value ?? null;
    const rd = p?.basis?.reducing ? all.get(p.basis.reducing) : null;
    const rr = p?.basis?.reduced ? all.get(p.basis.reduced) : null;
    if (!rd || !rr) {
      uncheckable++;
      continue;
    }
    const mine = rr.E0 - rd.E0;
    if (emf === null) uncheckable++;
    else if (Math.abs(mine - emf) <= 0.0051) agree++;
    else disagree.push({ metal: p.metal, reduces: p.reduces, mine, stored: emf });
    if (Boolean(p.spontaneous) !== mine > 0) sign_mismatch.push({ metal: p.metal, reduces: p.reduces, mine, stored: emf });
    const n = rd.n && rr.n ? lcm(rd.n, rr.n) : null;
    const slope = Number((store.doc.tables?.constants as any)?.nernst_slope_25C?.value ?? 0.05916);
    logK_recomputed.push({
      metal: p.metal,
      reduces: p.reduces,
      n_assumed: 2,
      n_mine: n,
      stored: p?.logK?.value ?? null,
      mine: n ? (n * mine) / slope : null,
    });
  }
  return { rows: preds, checked: agree + disagree.length, agree, disagree, sign_mismatch, uncheckable, logK_recomputed };
}
