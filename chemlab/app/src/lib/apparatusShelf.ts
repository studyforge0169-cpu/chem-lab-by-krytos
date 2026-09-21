/** The apparatus and materials shelf (prompt 15): the register read backwards.
 *
 *  `practical.ts` answers "this procedure wants what?". This answers the other question — "this
 *  piece of glassware: what is it for, what does it cost you in error, and who in the file asks for
 *  it?" — because a shelf with no one using it is either a spare or a stale row, and the app should be
 *  able to tell you which.
 */
import type { Store } from "../data/types.js";
import { g } from "./format.js";
import { apparatusList, prose, techniques, curriculum, type ApparatusRef } from "./practical.js";

export interface ShelfRow {
  id: string;
  label: string;
  kind: string;
  note: string;
  capacity: string | null;
  graduation: string | null;
  tolerance: string | null;
  /** the provenance the register carries for the tolerance, which is not always a number */
  tolerance_source: string | null;
  tolerance_confidence: string | null;
  relative_error: string | null;
  graduated: boolean | null;
  from: string;
  used_by: { techniques: string[]; kits: string[]; experiments: number; reactions: number };
  /** what it must not be used for, where the register says so in its note */
  limits: string | null;
}

export interface ShelfFilter {
  q: string;
  kind: string;
  /** "all" | "measured" (has a tolerance) | "unmeasured" | "unused" (nothing asks for it) */
  use: "all" | "measured" | "unmeasured" | "unused";
  limit: number;
}

export const DEFAULT_SHELF_FILTER: ShelfFilter = { q: "", kind: "all", use: "all", limit: 60 };

const prov = (x: unknown): { value: number | null; units: string | null; source: string | null; confidence: string | null } => {
  if (x === null || x === undefined) return { value: null, units: null, source: null, confidence: null };
  if (typeof x === "number") return { value: x, units: "mL", source: null, confidence: null };
  const o = x as any;
  return {
    value: typeof o.value === "number" ? o.value : null,
    units: o.units ? String(o.units) : "mL",
    source: o.source ? String(o.source) : null,
    confidence: o.confidence ? String(o.confidence) : null,
  };
};

/** who asks for each register id, in one pass over the practical layer */
function backrefs(store: Store): Map<string, { techniques: string[]; kits: string[]; experiments: number; reactions: number }> {
  const out = new Map<string, { techniques: string[]; kits: string[]; experiments: number; reactions: number }>();
  const add = (id: string | null, field: "techniques" | "kits" | "experiments" | "reactions", label?: string) => {
    if (!id) return;
    const key = String(id).toLowerCase();
    const cur = out.get(key) ?? { techniques: [], kits: [], experiments: 0, reactions: 0 };
    if (field === "techniques" && label && !cur.techniques.includes(label)) cur.techniques.push(label);
    if (field === "kits" && label && !cur.kits.includes(label)) cur.kits.push(label);
    if (field === "experiments") cur.experiments += 1;
    if (field === "reactions") cur.reactions += 1;
    out.set(key, cur);
  };
  for (const t of techniques(store)) {
    for (const a of t.apparatus) add(a.id, "techniques", t.name);
  }
  for (const [id, list] of Object.entries<any>((store.doc.lab?.kits ?? {}) as Record<string, any>)) {
    const { items } = apparatusList(store, list ?? []);
    for (const a of items) add(a.id, "kits", id);
  }
  for (const grp of curriculum(store)) for (const e of grp.experiments) for (const a of e.apparatus) add(a.id, "experiments");
  for (const r of store.doc.reactions ?? []) for (const a of ((r.safety as any)?.apparatus ?? []) as string[]) add(String(a).toLowerCase(), "reactions");
  return out;
}

const NOT_FOR = /\bnever\b|\bnot for\b|\bonly for\b|\bmust not\b|\birrelevant\b|\bnot a\b|\bcheap(er)? (plastic|one)\b/;

export function shelfRows(store: Store, f: ShelfFilter): { rows: ShelfRow[]; total: number; matched: number; truncated: boolean; kinds: { kind: string; count: number }[] } {
  const apps = (store.doc.tables?.apparatus ?? {}) as Record<string, any>;
  const glass = ((store.doc.tables?.glassware ?? []) as any[]) || [];
  const glassById = new Map<string, any>();
  for (const g2 of Array.isArray(glass) ? glass : []) if (g2?.id) glassById.set(String(g2.id).toLowerCase(), g2);
  const refs = backrefs(store);
  const q = f.q.trim().toLowerCase();
  const rows: ShelfRow[] = [];
  for (const [id, rec] of Object.entries<any>(apps)) {
    const fromGlass = glassById.get(id.toLowerCase());
    const tol = prov(rec?.tolerance_mL ?? fromGlass?.tolerance_mL);
    const cap = prov(rec?.capacity_mL ?? fromGlass?.capacity_mL);
    const grad = rec?.graduation_mL ?? fromGlass?.graduation_mL;
    const note = prose(rec?.note);
    const used = refs.get(id.toLowerCase()) ?? { techniques: [], kits: [], experiments: 0, reactions: 0 };
    const kind = String(rec?.kind ?? "unclassified");
    const row: ShelfRow = {
      id,
      label: String(rec?.name ?? id.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())),
      kind,
      note,
      capacity: cap.value !== null ? `${g(cap.value, 4)} ${cap.units ?? "mL"}` : null,
      graduation: typeof grad === "number" ? `every ${g(grad, 2)} ${cap.units ?? "mL"}` : null,
      tolerance: tol.value !== null ? `± ${g(tol.value, 2)} ${tol.units ?? "mL"}` : null,
      tolerance_source: tol.source,
      tolerance_confidence: tol.confidence,
      relative_error:
        tol.value !== null && cap.value ? `${g((100 * tol.value) / cap.value, 2)} % of its own capacity` : null,
      graduated: typeof rec?.graduated === "boolean" ? rec.graduated : tol.value !== null,
      from: fromGlass ? "tables.apparatus + tables.glassware" : "tables.apparatus",
      used_by: used,
      limits: NOT_FOR.test(note) ? note : null,
    };
    rows.push(row);
  }
  let matched = rows;
  if (f.kind !== "all") matched = matched.filter((r) => r.kind === f.kind);
  if (f.use === "measured") matched = matched.filter((r) => r.tolerance);
  if (f.use === "unmeasured") matched = matched.filter((r) => !r.tolerance);
  if (f.use === "unused") matched = matched.filter((r) => !r.used_by.techniques.length && !r.used_by.kits.length && !r.used_by.experiments && !r.used_by.reactions);
  if (q)
    matched = matched.filter((r) =>
      [r.id, r.label, r.kind, r.note, r.used_by.techniques.join(" "), r.used_by.kits.join(" ")].join(" ").toLowerCase().includes(q),
    );
  const sorted = [...matched].sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
  return {
    rows: sorted.slice(0, f.limit),
    total: rows.length,
    matched: matched.length,
    truncated: matched.length > f.limit,
    kinds: [...new Map(rows.map((r) => [r.kind, 0])).entries()]
      .map(([kind]) => ({ kind, count: rows.filter((r) => r.kind === kind).length }))
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
  };
}

export interface MaterialRow {
  name: string;
  /** the reactions that name it, so a consumable is never an anonymous line */
  reactions: { id: string; name: string }[];
  kits: string[];
}

export function materials(store: Store): MaterialRow[] {
  const list = ((store.doc.tables?.materials ?? []) as any[]) || [];
  const out: MaterialRow[] = [];
  for (const m of list) {
    const name = String(typeof m === "string" ? m : (m as any)?.name ?? (m as any)?.id ?? "");
    if (!name) continue;
    const reactions = (store.doc.reactions ?? [])
      .filter((r) => (((r.safety as any)?.materials ?? []) as string[]).some((x) => String(x).toLowerCase() === name.toLowerCase()))
      .map((r) => ({ id: r.id, name: r.name }));
    const kitsWith = Object.entries<any>((store.doc.lab?.kits ?? {}) as Record<string, any>)
      .filter(([, ids]) => (ids ?? []).some((x: string) => String(x).toLowerCase() === name.toLowerCase()))
      .map(([k]) => k);
    out.push({ name, reactions, kits: kitsWith });
  }
  return out;
}

/** the honest tail of a register: rows nothing asks for */
export function shelfCensus(store: Store) {
  const rows = shelfRows(store, { ...DEFAULT_SHELF_FILTER, limit: 100_000 }).rows;
  const n = (test: (r: ShelfRow) => boolean) => rows.filter(test).length;
  return {
    total: rows.length,
    with_tolerance: n((r) => !!r.tolerance),
    cited: n((r) => !!r.tolerance_source),
    measured_by_a_technique: n((r) => !!r.used_by.techniques.length),
    in_a_kit: n((r) => !!r.used_by.kits.length),
    in_the_syllabus: n((r) => r.used_by.experiments > 0),
    named_by_a_reaction: n((r) => r.used_by.reactions > 0),
    nothing_asks: n((r) => !r.used_by.techniques.length && !r.used_by.kits.length && !r.used_by.experiments && !r.used_by.reactions),
    prose_only_techniques: techniques(store).filter((t) => t.prose.length).length,
  };
}

export type { ApparatusRef };
