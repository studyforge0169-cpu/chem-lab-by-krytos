/** One search box over the whole warehouse (prompt 13). The ranking is the index's, in
 *  `src/data/search.ts` — this adds the notebook, which lives in browser storage and so cannot be in
 *  a build-time index, and puts the kind of every hit in words, because "Na" and "na" are not the
 *  same claim and the screen should not make you guess which one you got. */
import type { Store } from "../data/types.js";
import type { Note } from "./notebook.js";

export type FoundKind = "species" | "element" | "reaction" | "combination" | "note";

export interface Found {
  kind: FoundKind;
  /** the id to open: a species id, an element symbol, a reaction id, a pair, or a note id */
  id: string;
  label: string;
  sub: string;
  score: number;
  /** which store the hit came from, in the user's words */
  where: string;
}

export interface FoundPage {
  hits: Found[];
  /** hits the page left out, so the screen can say so instead of looking like the whole answer */
  more: number;
  kinds: { kind: FoundKind; count: number }[];
}

const KIND_WHERE: Record<FoundKind, string> = {
  species: "a bottle on the shelf",
  element: "an element in the table",
  reaction: "a reaction record",
  combination: "an element pair",
  note: "your own notebook",
};

const norm = (s: string) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9+()[\] -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function noteHay(n: Note): string {
  return norm(
    [
      n.title,
      n.verdict.status_line,
      n.verdict.reaction_name ?? "",
      n.bench.map((b) => `${b.name} ${b.qty}${b.unit === "mol" ? " mol" : b.unit}`).join(" "),
      n.guard.findings.map((f) => `${f.head} ${f.text}`).join(" "),
    ].join(" "),
  );
}

export function searchNotes(notes: Note[], q: string): Found[] {
  const nq = norm(q);
  if (!nq) return [];
  const words = nq.split(" ").filter(Boolean);
  const out: Found[] = [];
  for (const n of notes) {
    const hay = noteHay(n);
    let hit = 0;
    for (const w of words) if (hay.includes(w)) hit += 1;
    if (!hit) continue;
    const score = (hit / words.length) * 55 + (norm(n.title).startsWith(nq) ? 18 : 0);
    out.push({
      kind: "note",
      id: n.id,
      label: n.title,
      sub: `${n.saved_utc.slice(0, 10)} · ${n.verdict.status === "none" ? "nothing decided" : n.verdict.status}${n.guard.blocked ? " · refused" : ""}`,
      score,
      where: KIND_WHERE.note,
    });
  }
  return out;
}

const RANK: Record<FoundKind, number> = { element: 0, species: 1, reaction: 2, combination: 3, note: 4 };

export function searchAll(store: Store, notes: Note[], q: string, limit = 40): FoundPage {
  if (!q.trim()) return { hits: [], more: 0, kinds: [] };
  const fromIndex: Found[] = (store.search ? store.search(q, 400) : []).map((h: any) => ({
    kind: (["species", "element", "reaction", "combination"].includes(h.kind) ? h.kind : "species") as FoundKind,
    id: String(h.id),
    label: String(h.label ?? h.id),
    sub: String(h.sub ?? ""),
    score: Number(h.score ?? 0),
    where: KIND_WHERE[(["species", "element", "reaction", "combination"].includes(h.kind) ? h.kind : "species") as FoundKind],
  }));
  const all = [...fromIndex, ...searchNotes(notes, q)].sort(
    (a, b) =>
      b.score - a.score ||
      RANK[a.kind] - RANK[b.kind] ||
      a.label.length - b.label.length ||
      a.label.localeCompare(b.label),
  );
  const kinds = new Map<FoundKind, number>();
  for (const h of all) kinds.set(h.kind, (kinds.get(h.kind) ?? 0) + 1);
  return {
    hits: all.slice(0, limit),
    more: Math.max(0, all.length - limit),
    kinds: [...kinds.entries()].sort((a, b) => RANK[a[0]] - RANK[b[0]]).map(([kind, count]) => ({ kind, count })),
  };
}

/** what a hit opens. Kept here, not in the component, so the routing is a tested function: a hit
 *  whose target does not exist is reported rather than opened onto a blank sheet. */
export type Target = { ok: true; sheet?: any; note?: string } | { ok: false; why: string };

export function openTarget(store: Store, hit: Found): Target {
  if (hit.kind === "species") {
    if (!store.speciesById.has(hit.id)) return { ok: false, why: "the shelf has no record with that id" };
    return { ok: true, sheet: { kind: "species", id: hit.id } };
  }
  if (hit.kind === "element") {
    if (!store.elementBySymbol.has(hit.id)) return { ok: false, why: "that is not a symbol the element table has" };
    return { ok: true, sheet: { kind: "element", symbol: hit.id } };
  }
  if (hit.kind === "reaction") {
    if (!store.reactionById.has(hit.id)) return { ok: false, why: "the reaction index has no record with that id" };
    return { ok: true, sheet: { kind: "reaction", id: hit.id } };
  }
  if (hit.kind === "combination") {
    if (!store.combosByPair.has(hit.id)) return { ok: false, why: "no element-pair row carries that pair" };
    return { ok: true, sheet: { kind: "combination", pair: hit.id } };
  }
  // a saved run is not a sheet: it goes back on the bench, which is what it was saved from
  return { ok: true, note: hit.id };
}
