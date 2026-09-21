/** The reactions browser, prompt 13: 424 records, browsable the way a teacher picks a practical.
 *
 *  Every facet here is a question the *record* can answer, and the count next to it is counted from
 *  the rows rather than taken from a header, so the browser cannot advertise coverage it does not
 *  have. The census at the top of the screen is the same arithmetic, in words.
 */
import type { ReactionRec, Store } from "../data/types.js";
import { g } from "./format.js";

export interface ReactionFacet {
  id: string;
  label: string;
  group: "what you see" | "what the record can answer" | "hazard and control";
  /** the data's reason for the facet, printed when the filter is on */
  why: string;
  of: (r: ReactionRec, store: Store) => boolean;
}

const obs = (r: ReactionRec, kind: string) => (r.observations ?? []).some((o: any) => o?.kind === kind);
const anyObs = (r: ReactionRec, kinds: string[]) => (r.observations ?? []).some((o: any) => kinds.includes(o?.kind));
const s = (r: ReactionRec) => (r.safety ?? {}) as any;
const num = (p: any): number | null => (p && typeof p.value === "number" ? p.value : null);
const derived = (r: ReactionRec) => num((r.thermo_derived as any)?.dH_rxn);
const curated = (r: ReactionRec) => num((r.thermo_curated as any)?.dH);
const extra = (r: ReactionRec, k: string) => {
  const v = (r as any).kinetics?.[k] ?? (r as any).equilibrium?.[k] ?? (r as any).electrochem?.[k] ?? (r as any).thermo_curated?.[k];
  return v === null || v === undefined ? null : v;
};
const balanceProblems = (r: ReactionRec): string[] => {
  const b: any = (r as any).balance_check;
  return Array.isArray(b?.problems) ? b.problems : [];
};
const needsHood = (r: ReactionRec, store: Store) => {
  const list = (store.doc.safety_index as any)?.reactions_needing_hood;
  if (Array.isArray(list)) return list.includes(r.id);
  return /hood|fume/.test((s(r).controls ?? []).join(" ").toLowerCase());
};

export const FACETS: ReactionFacet[] = [
  { id: "gas", label: "gives off a gas", group: "what you see", why: "an observation the record codes as a gas", of: (r) => obs(r, "gas") },
  { id: "ppt", label: "a precipitate", group: "what you see", why: "the record codes a precipitate", of: (r) => obs(r, "precipitate") },
  { id: "colour", label: "a colour change", group: "what you see", why: "the record codes a colour change", of: (r) => obs(r, "colour_change") },
  { id: "light", label: "light or a flame", group: "what you see", why: "coded as light or flame", of: (r) => anyObs(r, ["light", "flame"]) },
  { id: "heat", label: "you can feel the heat", group: "what you see", why: "coded as a heat observation", of: (r) => obs(r, "heat") },
  { id: "sound", label: "a sound", group: "what you see", why: "coded as a sound (the squeak in a pop)", of: (r) => obs(r, "sound") },
  { id: "instant", label: "it happens in front of you", group: "what you see", why: "the record gives a timescale", of: (r) => obs(r, "timescale") },
  {
    id: "equation",
    label: "a balanced equation",
    group: "what the record can answer",
    why: "the build wrote the equation and re-counted the atoms",
    of: (r) => !!r.equation && balanceProblems(r).length === 0 && (r as any).balance_check?.atoms_ok !== false,
  },
  {
    id: "unbalanced",
    label: "the atom count disagrees",
    group: "what the record can answer",
    why: "the build's own check found a problem, and the record keeps it visible",
    of: (r) => balanceProblems(r).length > 0 || (r as any).balance_check?.atoms_ok === false,
  },
  {
    id: "dH_derived",
    label: "ΔH re-added from the ledger",
    group: "what the record can answer",
    why: "sum of the ΔfH terms, computed by the build",
    of: (r) => derived(r) !== null,
  },
  {
    id: "dH_curated",
    label: "ΔH as published",
    group: "what the record can answer",
    why: "the curated figure, quoted with its source",
    of: (r) => curated(r) !== null,
  },
  {
    id: "cross_check",
    label: "both, and they agree or do not",
    group: "what the record can answer",
    why: "a record with a published figure and a ledger to check it against",
    of: (r) => !!(r.thermo_derived as any)?.cross_check && curated(r) !== null,
  },
  { id: "T", label: "a temperature is named", group: "what the record can answer", why: "kinetics.T in the record", of: (r) => extra(r, "T") !== null },
  { id: "time", label: "a timescale to run it", group: "what the record can answer", why: "kinetics.time in the record", of: (r) => extra(r, "time") !== null },
  { id: "equilibrium", label: "an equilibrium constant", group: "what the record can answer", why: "logK, K or Kc on the record", of: (r) => !!(r as any).equilibrium },
  { id: "electrochem", label: "a cell: E° on the record", group: "what the record can answer", why: "the electrochem block", of: (r) => !!(r as any).electrochem },
  { id: "yield", label: "a yield is quoted", group: "what the record can answer", why: "thermo_curated.yield", of: (r) => extra(r, "yield") !== null },
  { id: "note", label: "a teaching note", group: "what the record can answer", why: "the record's own note to the person running it", of: (r) => !!(r.teaching_note ?? "").trim() },
  { id: "danger3", label: "danger 3 or worse", group: "hazard and control", why: "the record's own danger score", of: (r) => typeof s(r).danger_score === "number" && s(r).danger_score >= 3 },
  { id: "controls", label: "lists controls", group: "hazard and control", why: "safety.controls is not empty", of: (r) => (s(r).controls ?? []).length > 0 },
  { id: "hood", label: "needs a fume hood", group: "hazard and control", why: "safety_index.reactions_needing_hood", of: (r, store) => needsHood(r, store) },
  { id: "scale", label: "sets a maximum scale", group: "hazard and control", why: "safety.max_scale — above it the app hides the quantities", of: (r) => !!s(r).max_scale },
  { id: "blocked", label: "you must not do this", group: "hazard and control", why: "safety.blocked", of: (r) => !!s(r).blocked },
  { id: "apparatus", label: "names the apparatus", group: "hazard and control", why: "safety.apparatus is not empty", of: (r) => (s(r).apparatus ?? []).length > 0 },
];

export const FACET_BY_ID = new Map(FACETS.map((f) => [f.id, f]));

export type ReactSort = "name" | "danger" | "dH" | "category" | "observations";

export interface ReactFilter {
  q: string;
  /** one of the data's own category words, or "all" */
  cat: string;
  /** one of the tags, or "" */
  tag: string;
  type: "all" | "equation" | "process";
  facets: string[];
  sort: ReactSort;
  desc: boolean;
  limit: number;
}

export const DEFAULT_REACT_FILTER: ReactFilter = {
  q: "",
  cat: "all",
  tag: "",
  type: "all",
  facets: [],
  sort: "name",
  desc: false,
  limit: 120,
};

export interface ReactRow {
  id: string;
  name: string;
  typeLabel: string;
  cats: string[];
  tags: string[];
  equation: string | null;
  /** what the build's atom count said, in words */
  balanced: string | null;
  dH: string | null;
  dHFrom: string | null;
  obs: { kind: string; text: string }[];
  danger: number | null;
  controls: string[];
  blocked: boolean;
  hood: boolean;
  scale: string | null;
  /** the facet labels this record satisfies, so a row shows what it can answer even when you are not filtering */
  has: string[];
  reactants: string[];
  products: string[];
}

export function reactRow(store: Store, r: ReactionRec): ReactRow {
  const d = derived(r);
  const c = curated(r);
  const bc: any = (r as any).balance_check;
  const problems = balanceProblems(r);
  return {
    id: r.id,
    name: r.name,
    typeLabel: r.record_type === "equation" ? "equation" : r.record_type === "process" ? "process" : String(r.record_type ?? "record"),
    cats: (r.categories ?? []).slice(0, 5),
    tags: (r.tags ?? []).slice(0, 4),
    equation: r.equation ?? null,
    balanced: r.equation
      ? problems.length
        ? `the build's atom count disagrees: ${problems.slice(0, 2).join("; ")}`
        : bc?.atoms_ok
          ? "atoms and charge re-counted by the build"
          : "no atom count on this record"
      : null,
    dH: c !== null ? g(c, 5) : d !== null ? g(d, 5) : null,
    dHFrom: c !== null ? "the curated figure" : d !== null ? "re-added from the ΔfH ledger" : null,
    obs: (r.observations ?? []).map((o: any) => ({ kind: String(o?.kind ?? ""), text: String(o?.text ?? "") })).filter((o) => o.text),
    danger: typeof s(r).danger_score === "number" ? s(r).danger_score : null,
    controls: (s(r).controls ?? []) as string[],
    blocked: !!s(r).blocked,
    hood: needsHood(r, store),
    scale: s(r).max_scale ? String(s(r).max_scale) : null,
    has: FACETS.filter((f) => f.of(r, store)).map((f) => f.label),
    reactants: ((r.reactants_written ?? "") as string).split(/\s*[,+]\s*/).filter(Boolean),
    products: ((r.products_written ?? "") as string).split(/\s*[,+]\s*/).filter(Boolean),
  };
}

export interface ReactPage {
  rows: ReactRow[];
  total: number;
  matched: number;
  truncated: boolean;
  how: string;
  cats: { name: string; count: number }[];
  tags: { name: string; count: number }[];
  facetCounts: Record<string, number>;
  /** the facets currently on, with the data's reason for each */
  active: { label: string; why: string }[];
}

export function filterReactions(store: Store, f: ReactFilter): ReactPage {
  const all = store.doc.reactions ?? [];
  const q = f.q.trim().toLowerCase();
  let rows = all;

  if (f.cat !== "all") rows = rows.filter((r) => (r.categories ?? []).includes(f.cat));
  if (f.tag) rows = rows.filter((r) => (r.tags ?? []).includes(f.tag));
  if (f.type !== "all") rows = rows.filter((r) => r.record_type === f.type);
  for (const id of f.facets) {
    const facet = FACET_BY_ID.get(id);
    if (facet) rows = rows.filter((r) => facet.of(r, store));
  }
  if (q)
    rows = rows.filter((r) =>
      [r.name, r.equation, r.reactants_written, r.products_written, (r.categories ?? []).join(" "), (r.tags ?? []).join(" "), r.teaching_note]
        .filter(Boolean)
        .some((t) => String(t).toLowerCase().includes(q)),
    );

  const matched = rows.length;
  const val = (r: ReactionRec): number | null =>
    f.sort === "danger"
      ? (typeof s(r).danger_score === "number" ? s(r).danger_score : null)
      : f.sort === "dH"
        ? (() => {
            const v = curated(r) ?? derived(r);
            return v === null ? null : Math.abs(v);
          })()
        : f.sort === "observations"
          ? (r.observations ?? []).length
          : null;
  const list = [...rows];
  if (f.sort === "name" || f.sort === "category")
    list.sort((a, b) =>
      f.sort === "name"
        ? a.name.localeCompare(b.name)
        : ((a.categories ?? [])[0] ?? "").localeCompare((b.categories ?? [])[0] ?? "") || a.name.localeCompare(b.name),
    );
  else
    list.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va === null && vb === null) return a.name.localeCompare(b.name);
      if (va === null) return 1; // a record without the number goes last, whichever way you sort
      if (vb === null) return -1;
      return f.desc ? vb - va : va - vb;
    });

  const facetCounts: Record<string, number> = {};
  for (const facet of FACETS) facetCounts[facet.id] = all.filter((r) => facet.of(r, store)).length;

  return {
    rows: list.slice(0, f.limit).map((r) => reactRow(store, r)),
    total: all.length,
    matched,
    truncated: matched > f.limit,
    how: describe(f, matched, all.length),
    cats: tally(all.flatMap((r) => r.categories ?? [])).map(([name, count]) => ({ name, count })),
    tags: tally(all.flatMap((r) => r.tags ?? [])).slice(0, 40).map(([name, count]) => ({ name, count })),
    facetCounts,
    active: f.facets.map((id) => ({ label: FACET_BY_ID.get(id)?.label ?? id, why: FACET_BY_ID.get(id)?.why ?? "" })),
  };
}

function describe(f: ReactFilter, n: number, total: number): string {
  const bits: string[] = [];
  if (f.cat !== "all") bits.push(`category “${f.cat}”`);
  if (f.tag) bits.push(`tag “${f.tag}”`);
  if (f.type !== "all") bits.push(`${f.type} records only`);
  if (f.facets.length) bits.push(`${f.facets.length} condition${f.facets.length === 1 ? "" : "s"} the records must answer to`);
  if (f.q.trim()) bits.push(`text “${f.q.trim()}”`);
  return bits.length ? `${bits.join(" · ")} — ${n} of the ${total} records match` : `every record in the file: ${n}`;
}

export function reactCategories(store: Store) {
  return tally((store.doc.reactions ?? []).flatMap((r) => r.categories ?? []));
}

/** what the file can answer, field by field, counted from the rows. The browser prints this because
 *  a catalogue of 424 records looks complete whether or not it is. */
export function coverageCensus(store: Store): { field: string; count: number; rest: string }[] {
  const all = store.doc.reactions ?? [];
  const n = all.length;
  const c = (test: (r: ReactionRec) => boolean) => all.filter(test).length;
  const line = (field: string, count: number, rest: string) => ({ field, count, rest });
  return [
    line("a balanced equation the build re-counted", c((r) => !!r.equation && balanceProblems(r).length === 0), `${n - c((r) => !!r.equation)} are process records: a procedure, not an equation`),
    line("a ΔH of some kind", c((r) => derived(r) !== null || curated(r) !== null), `${n - c((r) => derived(r) !== null || curated(r) !== null)} name no enthalpy, and the app does not estimate one`),
    line("ΔH as published, next to the ledger's", c((r) => curated(r) !== null && derived(r) !== null), "where both are present the sheet prints the gap between them, whichever way it falls"),
    line("a temperature or timescale", c((r) => extra(r, "T") !== null || extra(r, "time") !== null), `${n - c((r) => extra(r, "T") !== null || extra(r, "time") !== null)} say nothing about how fast or at what temperature`),
    line("an observation for every sense the record codes", c((r) => (r.observations ?? []).length > 0), "a narrative is present on every record; the colour, gas and precipitate codes are not"),
    line("a hazard score", c((r) => typeof s(r).danger_score === "number"), `${n - c((r) => typeof s(r).danger_score === "number")} carry no danger score, which is not the same as carrying none`),
    line("controls the guard can check", c((r) => (s(r).controls ?? []).length > 0), "the other records ask for nothing beyond the bench's own context"),
    line("a maximum scale", c((r) => !!s(r).max_scale), "above that scale the quantities are withheld; the equation and the energy stay"),
    line("a refusal", c((r) => !!s(r).blocked), "these are shown as data with the route taken away, never as an option"),
    line("the apparatus it is done with", c((r) => (s(r).apparatus ?? []).length > 0), `${n - c((r) => (s(r).apparatus ?? []).length > 0)} name no glassware`),
    line("a teaching note", c((r) => !!(r.teaching_note ?? "").trim()), "what the person running it should say afterwards"),
    {
      field: "a curriculum appearance",
      count: c((r) => {
        const a: any = (r as any).appears;
        if (!a) return false;
        // an appearance is a list of named experiments; the colour pair in this field is not one
        if (Array.isArray(a)) return a.length > 0;
        return [a.gases, a.precipitates].some((v: any) => Array.isArray(v) && v.filter((x: any) => x != null).length > 0);
      }),
      rest: "none: the field carries colour pairs, never an experiment name — the syllabus index that does exist is `lab.curriculum`, keyed by experiment, and that is what the Work tab reads",
    },
  ];
}

function tally(xs: string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** every id the browser can link to, checked against the store: a row that opens a sheet that does
 *  not exist is a bug the user finds, so the test finds it first */
export function apparatusRegister(store: Store): { ids: Set<string>; names: Set<string> } {
  const t = (store.doc.tables?.apparatus ?? {}) as any;
  const ids = new Set<string>();
  const names = new Set<string>();
  const add = (id: string, name?: string) => {
    ids.add(id.toLowerCase());
    if (name) names.add(String(name).toLowerCase());
  };
  if (Array.isArray(t)) for (const x of t) add(String(x?.id ?? ""), x?.name);
  else for (const [k, v] of Object.entries<any>(t)) add(k, (v as any)?.name);
  return { ids, names };
}

/** the materials table is a plain list of names, not a register with fields */
export function materialList(store: Store): Set<string> {
  const t = (store.doc.tables?.materials ?? []) as any;
  const out = new Set<string>();
  if (Array.isArray(t)) for (const x of t) out.add(String(typeof x === "string" ? x : x?.id ?? x?.name ?? "").toLowerCase());
  else for (const k of Object.keys(t ?? {})) out.add(k.toLowerCase());
  return out;
}

/** every link this screen can follow, checked against the store: a row that opens a sheet that does
 *  not exist is a bug the user finds, so the test finds it first */
export function deadLinks(store: Store): string[] {
  const out: string[] = [];
  const reg = apparatusRegister(store);
  const mats = materialList(store);
  for (const r of store.doc.reactions ?? []) {
    if (!store.reactionById.has(r.id)) out.push(`reactions[].${r.id} is not in the index`);
    for (const t of [...(r.reactants ?? []), ...(r.products ?? [])] as any[]) {
      const id = t?.species_id;
      if (id && !store.speciesById.has(id)) out.push(`${r.id} names ${id}, which the shelf does not have`);
    }
    for (const a of s(r).apparatus ?? []) {
      const k = String(a).toLowerCase();
      if (!reg.ids.has(k) && !reg.names.has(k)) out.push(`${r.id} names apparatus ${a}, which tables.apparatus does not have`);
    }
    for (const m of s(r).materials ?? []) if (mats.size && !mats.has(String(m).toLowerCase())) out.push(`${r.id} names material ${m}, which tables.materials does not have`);
    for (const c of s(r).controls ?? []) {
      const id = String(c).toLowerCase();
      const known = (store.doc as any).lab?.mixing_rules?.[id] || (store.doc.tables?.controls as any)?.[id] || (store.doc.tables?.safety_limits as any)?.[id];
      if (!known && id.length < 3) out.push(`${r.id} names a control of unreadable length: ${c}`);
    }
  }
  return out;
}
