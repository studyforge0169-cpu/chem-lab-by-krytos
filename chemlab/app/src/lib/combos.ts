/** The element-pair browser, prompt 11.
 *
 *  9410 rows: every pair of elements, the formula their common oxidation states allow, and what
 *  is real about it. The app filters and counts them; it never re-states a fact from a row in its
 *  own words - each field on a row already carries `{value, units, source, confidence}`, and the
 *  provenance component prints it, so there is nothing for this file to paraphrase.
 */
import type { CombinationRec, SpeciesRec, Store } from "../data/types.js";
import { elementElectrodes, halfCells, type HalfCell } from "./cell.js";
import { g, ionLabel } from "./format.js";

export type ComboStatus = "all" | "verified" | "empirical" | "predicted" | "none";

export interface ComboFilter {
  /** "na cl", "NaCl", "peroxide" - element symbols are read out of the text */
  q: string;
  status: ComboStatus;
  /** only rows with a cell emf on them */
  hasEmf: boolean;
  /** only rows with a verdict from the precipitation or acid-base rules */
  hasVerdict: boolean;
  sort: "pair" | "mass" | "emf" | "ionic" | "dchi";
  /** reverse the sort */
  desc: boolean;
  limit: number;
}

export const COMBO_STATUSES: ComboStatus[] = ["all", "verified", "empirical", "predicted", "none"];
export const COMBO_SORTS: { id: ComboFilter["sort"]; label: string }[] = [
  { id: "pair", label: "by pair" },
  { id: "mass", label: "by molar mass" },
  { id: "emf", label: "by emf" },
  { id: "ionic", label: "by % ionic character" },
  { id: "dchi", label: "by electronegativity difference" },
];

export const DEFAULT_FILTER: ComboFilter = {
  q: "",
  status: "all",
  hasEmf: false,
  hasVerdict: false,
  sort: "pair",
  desc: false,
  limit: 200,
};

/** the status words, and what each one means - the browser shows this legend because the difference
 *  between "verified" and "predicted" is the whole point of the file */
export const STATUS_MEANING: Record<string, string> = {
  verified: "a species record in the warehouse is this compound, so everything on the sheet is cited",
  empirical: "the compound is real and named, but this build has no species record for it to point at",
  predicted: "arithmetic only: the valence rules give the formula, and the mass, Δχ and ionic character follow from it",
  none: "the data says nothing forms - and the row carries the sentence for why",
};

const num = (p: any): number | null => (p && typeof p.value === "number" ? p.value : null);

/** the two element symbols in a query, if there are two. "na cl", "Na-Cl" and "NaCl" all mean the
 *  same pair; a run-together formula is split longest-symbol first so CaCl is Ca+Cl and not C+Ac. */
export function symbolsIn(q: string, store: Store): string[] {
  const out: string[] = [];
  /* A typed formula keeps its case, so read it case-first: CuSO4 is Cu, S, O and not the
     nonsense C, U, S, O that lower-casing first would give. Only when the text has no capitals to
     work with do we fall back to capitalising words, which is what "na cl" and "cl na" need. */
  for (const m of q.matchAll(/([A-Z][a-z]?)/g)) {
    const sym = m[1];
    if (store.elementBySymbol.has(sym) && !out.includes(sym)) out.push(sym);
  }
  if (out.length >= 2) return out;
  const words: string[] = [];
  for (const w of q.toLowerCase().split(/[^a-z]+/).filter(Boolean)) {
    const sym = w[0].toUpperCase() + w.slice(1);
    if (store.elementBySymbol.has(sym) && !words.includes(sym)) words.push(sym);
  }
  if (words.length >= 2) return words;
  /* one word run-together in lower case, "nacl": try the split that makes two real symbols */
  const flat = q.toLowerCase().replace(/[^a-z]/g, "");
  for (let i = 2; i >= 1 && i < flat.length; i--) {
    const a = flat.slice(0, i);
    const b = flat.slice(i, i + 2);
    const A = a[0].toUpperCase() + a.slice(1);
    const B = b[0].toUpperCase() + b.slice(1);
    if (store.elementBySymbol.has(A) && store.elementBySymbol.has(B) && A !== B) return [A, B];
  }
  return [];
}

export interface ComboRowModel {
  pair: string;
  elements: string[];
  formula: string;
  states: string;
  status: string;
  statusWord: string;
  mass: string;
  dchi: string;
  ionic: string;
  emf: string | null;
  logK: string | null;
  verdict: string | null;
  why: string | null;
  why_no_verdict: string | null;
  note: string | null;
  species?: SpeciesRec;
  species_name: string | null;
  reaction_count: number;
  raw: CombinationRec;
}

export function rowModel(store: Store, c: CombinationRec): ComboRowModel {
  const sp = c.species_id ? store.speciesById.get(c.species_id) : undefined;
  return {
    pair: c.pair,
    elements: c.elements ?? [],
    formula: c.formula ? ionLabel(c.formula) : "—",
    states: c.states ? c.elements.map((e, i) => `${e}${(c.states as number[])[i] > 0 ? "+" : ""}${(c.states as number[])[i]}`).join(" / ") : "no oxidation states to combine",
    status: c.status,
    statusWord: c.status,
    mass: num(c.molar_mass) === null ? "—" : `${g(num(c.molar_mass)!, 5)} g/mol`,
    /* three figures because the file quotes Δχ to two decimals: two sig figs would round 2.23 to 2.2 */
    dchi: num(c.electronegativity_difference) === null ? "—" : `Δχ ${g(num(c.electronegativity_difference)!, 3)}`,
    ionic: num(c.percent_ionic_character) === null ? "—" : `${g(num(c.percent_ionic_character)!, 3)} % ionic`,
    emf: c.predicted_emf ? `${g((c.predicted_emf as any).value, 4)} V` : null,
    logK: num(c.log_k as any) === null ? null : g(num(c.log_k as any)!, 4),
    verdict: c.verdict ?? null,
    why: c.why ?? null,
    why_no_verdict: (c as any).why_no_verdict ?? null,
    note: c.note ?? null,
    species: sp,
    species_name: sp?.name ?? null,
    reaction_count: (c.reaction_ids ?? []).length,
    raw: c,
  };
}

export interface ComboPage {
  rows: ComboRowModel[];
  total: number;
  matched: number;
  truncated: boolean;
  counts: Record<string, number>;
  how: string;
}

export function filterCombos(store: Store, f: ComboFilter): ComboPage {
  const all = store.combos;
  const counts: Record<string, number> = {};
  for (const c of all) counts[c.status] = (counts[c.status] ?? 0) + 1;

  const syms = symbolsIn(f.q, store);
  let rows: CombinationRec[];
  let how: string;
  if (syms.length >= 2) {
    /* a run of symbols is an atom set first and a pair second: CuSO4 names three elements, and
       there is no three-element row to find, so the pair of the first two is what the file can
       answer - and the line says which of the two it did, because the difference matters */
    const want = [...new Set(syms)].sort();
    const hit = all.filter((c) => {
      const have = [...new Set((c.elements ?? []) as string[])].sort();
      return have.length === want.length && have.every((x, i) => x === want[i]);
    });
    if (hit.length) {
      rows = hit;
      how = `rows made of exactly these atoms: ${want.join(" + ")} — ${rows.length} row${rows.length === 1 ? "" : "s"}`;
    } else {
      const key = [syms[0], syms[1]].sort().join("-");
      rows = store.combosByPair.get(key) ?? [];
      how = `no row is made of exactly ${want.join(" + ")}, so the pair ${key} is shown instead: ${rows.length} row${rows.length === 1 ? "" : "s"}`;
    }
  } else if (f.q.trim()) {
    const q = f.q.trim().toLowerCase();
    rows = all.filter(
      (c) =>
        c.pair.toLowerCase().includes(q) ||
        (c.formula ?? "").toLowerCase().includes(q) ||
        ((c as any).name ?? "").toLowerCase().includes(q) ||
        (c.why ?? "").toLowerCase().includes(q),
    );
    how = `text match on “${f.q.trim()}” across pair, formula, name and the data's own reasons`;
  } else {
    rows = all;
    how = `every pair in the file: ${all.length}`;
  }

  if (f.status !== "all") rows = rows.filter((c) => c.status === f.status);
  if (f.hasEmf) rows = rows.filter((c) => !!c.predicted_emf);
  if (f.hasVerdict) rows = rows.filter((c) => !!c.verdict);

  const val = (c: CombinationRec) =>
    f.sort === "mass"
      ? num(c.molar_mass)
      : f.sort === "emf"
        ? num(c.predicted_emf as any)
        : f.sort === "ionic"
          ? num(c.percent_ionic_character)
          : f.sort === "dchi"
            ? num(c.electronegativity_difference)
            : null;
  if (f.sort !== "pair")
    rows = [...rows].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va === null && vb === null) return a.pair.localeCompare(b.pair);
      if (va === null) return 1; // a row without the number sorts last, whichever way you read it
      if (vb === null) return -1;
      return f.desc ? vb - va : va - vb;
    });
  else rows = [...rows].sort((a, b) => (f.desc ? b.pair.localeCompare(a.pair) : a.pair.localeCompare(b.pair)));

  const matched = rows.length;
  const shown = rows.slice(0, f.limit);
  return {
    rows: shown.map((c) => rowModel(store, c)),
    total: all.length,
    matched,
    truncated: matched > shown.length,
    counts,
    how,
  };
}

/** counts the app works out for itself. The shipped `meta` block also carries counts, and if the
 *  two ever disagree the browser says so out loud rather than picking the flattering one. */
export function comboAudit(store: Store): {
  rows: number;
  byStatus: Record<string, number>;
  with_emf: number;
  with_verdict: number;
  pointing_at_a_species: number;
  dead_links: string[];
  meta: any;
  disagreements: string[];
} {
  const all = store.combos;
  const byStatus: Record<string, number> = {};
  let with_emf = 0;
  let with_verdict = 0;
  let pointing = 0;
  const dead: string[] = [];
  for (const c of all) {
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
    if (c.predicted_emf) with_emf++;
    if (c.verdict) with_verdict++;
    if (c.species_id) {
      pointing++;
      if (!store.speciesById.has(c.species_id)) dead.push(`${c.pair} → ${c.species_id}`);
    }
  }
  const meta = store.combosMeta ?? null;
  const disagreements: string[] = [];
  if (meta) {
    for (const k of ["rows", "verified", "with_emf"]) {
      const mine = k === "rows" ? all.length : k === "verified" ? byStatus.verified ?? 0 : with_emf;
      if (typeof meta[k] === "number" && meta[k] !== mine)
        disagreements.push(`the file's meta says ${k} = ${meta[k]}, the rows themselves give ${mine}`);
    }
  }
  return {
    rows: all.length,
    byStatus,
    with_emf,
    with_verdict,
    pointing_at_a_species: pointing,
    dead_links: dead,
    meta,
    disagreements,
  };
}

/** the element electrodes this pair could be built from, both ways round, with the difference the
 *  app would print. A pair often has more than one couple per element (Cu+/Cu and Cu2+/Cu against
 *  Fe3+/Fe and Fe2+/Fe is four cells), so the browser lists them instead of choosing one. */
export function pairCells(
  store: Store,
  els: string[],
  rowCouples?: string[] | null,
): { a: CellSide; b: CellSide; E: number; from_row: boolean }[] {
  const side = (h: HalfCell) => h.red.name.replace(/\s+/g, "");
  const byEl = new Map<string, CellSide[]>();
  const all = new Map<string, CellSide>();
  for (const h of elementElectrodes(store)) {
    const e = side(h);
    if (!byEl.has(e)) byEl.set(e, []);
    byEl.get(e)!.push({ key: h.key, E0: h.E0, n: h.n });
  }
  for (const h of halfCells(store)) all.set(h.key, { key: h.key, E0: h.E0, n: h.n });

  const out: { a: CellSide; b: CellSide; E: number; from_row: boolean }[] = [];
  const left = els[0] ? byEl.get(els[0]) ?? [] : [];
  const right = els[1] ? byEl.get(els[1]) ?? [] : [];
  for (const a of left)
    for (const b of right) {
      const cathode = a.E0 >= b.E0 ? a : b;
      const anode = cathode === a ? b : a;
      out.push({ a: anode, b: cathode, E: cathode.E0 - anode.E0, from_row: false });
    }
  if (out.length) return out.sort((x, y) => y.E - x.E);

  /* no two metal strips to compare - chlorine, oxygen and the rest are not strips. The row itself
     names the couples it used, so the app recomputes from those keys and says where they came from
     rather than telling the user there is nothing to show. */
  const named = (rowCouples ?? []).map((k) => all.get(k)).filter(Boolean) as CellSide[];
  for (let i = 0; i < named.length; i++)
    for (let j = 0; j < named.length; j++) {
      if (i === j || named[i].key === named[j].key) continue;
      const cathode = named[i].E0 >= named[j].E0 ? named[i] : named[j];
      const anode = cathode === named[i] ? named[j] : named[i];
      const e = { a: anode, b: cathode, E: cathode.E0 - anode.E0, from_row: true };
      if (!out.some((x) => x.a.key === e.a.key && x.b.key === e.b.key)) out.push(e);
    }
  return out.sort((x, y) => y.E - x.E);
}

export interface CellSide {
  key: string;
  E0: number;
  n: number | null;
}

/** the emf chain on a row: what the numbers are, what they were computed from, and what they do
 *  not say. The prompt asks for the chain, so it is printed as a chain. */
export function emfChain(c: CombinationRec): { line: string; from: string; caveat: string }[] {
  const out: { line: string; from: string; caveat: string }[] = [];
  const emf: any = c.predicted_emf;
  if (!emf) return out;
  out.push({
    line: `emf ${g(emf.value, 4)} ${emf.units ?? "V"}`,
    from: String(emf.source ?? "no source string on the row"),
    caveat: String(emf.note ?? ""),
  });
  const lk: any = (c as any).log_k;
  if (lk && typeof lk.value === "number")
    out.push({ line: `log K ${g(lk.value, 4)}`, from: String(lk.source ?? "no source"), caveat: String(lk.note ?? "") });
  const dg: any = (c as any).delta_g_kJ_per_mol;
  if (dg && typeof dg.value === "number")
    out.push({ line: `ΔG ${g(dg.value, 5)} ${dg.units ?? "kJ/mol"}`, from: String(dg.source ?? "no source"), caveat: String(dg.note ?? "") });
  if (c.verdict) out.push({ line: `verdict: ${c.verdict}`, from: "the row's own verdict field", caveat: "" });
  return out;
}
