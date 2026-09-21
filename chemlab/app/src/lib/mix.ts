/** What happens when the bench items are put in one beaker - decided only by the warehouse.
 *
 *  Three answers, in this order, because that is the order the data is trustworthy in:
 *  a curated reaction record, then the ion-pair matrix if everything is in water, then
 *  "not covered". The last one is a result and the UI must show it as one. */
import type { PrecipRow, ReactionRec, SpeciesRec, Store } from "../data/types.js";
import { toMoles, type Moles } from "./amounts.js";
import { DEFAULT_CTX, guardBench, type GuardCtx, type GuardVerdict } from "./guard.js";
import type { BenchItem } from "../state/app.js";

export interface MixItem {
  item: BenchItem;
  species?: SpeciesRec;
  moles: Moles;
}
export interface IonPair {
  row: PrecipRow;
  from: [string, string]; // which two bottles' ions this pair came from
}
export interface MixResult {
  items: MixItem[];
  branch: "empty" | "reaction" | "ions" | "nothing";
  reaction?: ReactionRec;
  /** why this record was chosen, and what the match was on */
  matchNote?: string;
  reactions?: { r: ReactionRec; note: string }[];
  pairs?: IonPair[];
  status: "verified" | "rule" | "none";
  statusLine: string;
  /** the block-level findings, kept in this shape because the bench banner predates the guard */
  refused?: { what: string; why: string }[];
  /** the full verdict, from src/lib/guard.ts - the bench shows this, not a summary of it */
  guard?: GuardVerdict;
  problems: string[];
}

const hillOf = (s?: SpeciesRec) => s?.formula ?? null;
const ionIdsOf = (s: SpeciesRec, store: Store): { cat?: string; an?: string } => {
  if (s.kind === "aqueous_ion") {
    const id = s.id;
    const cation = store.precipList.some((r) => r.cation_id === id);
    return cation ? { cat: id } : { an: id };
  }
  const h = hillOf(s);
  if (!h) return {};
  const rows = store.precipByProduct.get(h) ?? [];
  // prefer a row whose ion counts reproduce this formula's atom counts
  const want = s.elements ?? {};
  const best =
    rows.find((r) => {
      const c = store.speciesById.get(r.cation_id)?.elements ?? {};
      const a = store.speciesById.get(r.anion_id)?.elements ?? {};
      const all: Record<string, number> = {};
      for (const [k, v] of [...Object.entries(c), ...Object.entries(a)])
        all[k] = (all[k] ?? 0) + (v as number);
      return Object.keys(want).every((k) => (want as any)[k] === all[k]);
    }) ?? rows[0];
  return best ? { cat: best.cation_id, an: best.anion_id } : {};
};

/** The bench's answer, and then the guard's answer about the bench.
 *
 *  `decideMix` used to carry a miniature version of the safety layer; prompt 10 replaced it, so
 *  there is now one guard that the bench, the safety tab and the reaction sheet all read. The
 *  context is the same one the Safety tab sets, because a hood is a fact about the room and not
 *  about a screen. */
export function decideMix(bench: BenchItem[], store: Store, ctx: GuardCtx = DEFAULT_CTX): MixResult {
  const res = decideMixInner(bench, store);
  const guard = guardBench(bench, store, ctx, res.branch === "reaction" ? res.reaction?.id ?? null : null);
  const refused = guard.findings.filter((f) => f.level === "block").map((f) => ({ what: f.head, why: f.text }));
  return { ...res, guard, refused: refused.length ? refused : undefined };
}

function decideMixInner(bench: BenchItem[], store: Store): MixResult {
  const problems: string[] = [];
  const items: MixItem[] = bench.map((item) => {
    const species = store.speciesById.get(item.species_id);
    const moles = toMoles(item, species, store.doc.lab?.stock_bottles ?? []);
    if (moles.moles === null && moles.basis) problems.push(`${species?.name ?? item.species_id}: ${moles.basis}`);
    return { item, species, moles };
  });
  if (!items.length)
    return { items, branch: "empty", status: "none", statusLine: "nothing on the bench yet", problems };

  // 1. a curated reaction whose reactants are all present, matched on formula so that
  //    "the bottle" and "the token in the equation" are allowed to be different records
  const present = new Set(items.map((i) => hillOf(i.species)).filter(Boolean) as string[]);
  const exact = new Set(items.map((i) => i.item.species_id));
  const written = new Map<string, string>();
  for (const sp of store.species) if (sp.formula) written.set(sp.formula, sp.formula_written ?? sp.formula);
  const matches: { r: ReactionRec; note: string; rank: number }[] = [];
  for (const r of store.reactions) {
    const req = (r.reactants ?? []).map((t) => t.species_id).filter(Boolean) as string[];
    const reqHill = (r.reactants ?? [])
      .map((t) => store.speciesById.get(t.species_id ?? "")?.formula)
      .filter(Boolean) as string[];
    if (!req.length) continue;
    // a record with one reactant is not an answer about a beaker that holds two things -
    // without this guard "hydrogen diffuses through a membrane" wins over "hydrogen burns"
    if (present.size >= 2 && reqHill.length < 2) continue;
    const idsOk = req.every((id) => exact.has(id));
    const hillOk = reqHill.length > 0 && reqHill.every((h) => present.has(h));
    if (!idsOk && !hillOk) continue;
    const coversAll = reqHill.length >= present.size;
    const rank = idsOk ? (coversAll ? 0 : 1) : hillOk ? (coversAll ? 2 : 3) : 4;
    matches.push({
      r,
      rank,
      note: idsOk
        ? `these exact bottles are the reactants of a curated record${coversAll ? "" : " — and something on your bench is not in it, so it is a partial match"}`
        : `matched on formula, not on the bottle id: the record writes ${reqHill
            .map((h) => written.get(h) ?? h)
            .join(" + ")}, and your bottles are the same substances`,
    });
  }
  // several records can contain exactly the same reactants (burning hydrogen, a fuel cell,
  // the eudiometer demo). The app does not pretend one is "the" answer: it puts the richest
  // record first - the one with the most observations, which is the one that tells you what
  // you would see - and lists the rest under the verdict.
  const richness = (r: ReactionRec) =>
    (r.observations?.length ?? 0) * 2 + (r.teaching_note ? 1 : 0) + (r.equation ? 1 : 0);
  matches.sort(
    (a, b) =>
      a.rank - b.rank ||
      richness(b.r) - richness(a.r) ||
      (b.r.reactants?.length ?? 0) - (a.r.reactants?.length ?? 0) ||
      a.r.id.localeCompare(b.r.id),
  );
  if (matches.length) {
    const best = matches[0]!;
    return {
      items,
      branch: "reaction",
      reaction: best.r,
      matchNote: best.note,
      reactions: matches.slice(0, 6).map((m) => ({ r: m.r, note: m.note })),
      status: "verified",
      statusLine: `${matches.length > 1 ? `${matches.length} records in this dataset contain exactly these · showing the one that describes the most` : "in this dataset"} · ${best.r.record_type === "process" ? "a process record, not a balanced equation" : "a balanced equation, checked by the build"}`,
      problems,
    };
  }

  // 2. everything in water: cross the ions over and ask the matrix
  const ions = items.map((i) => ({ id: i.species!.id, ...ionIdsOf(i.species!, store) }));
  const unresolved = ions.filter((x) => !x.cat && !x.an).map((x) => store.speciesById.get(x.id)?.name ?? x.id);
  if (ions.length >= 2 && ions.every((x) => x.cat || x.an)) {
    const pairs: IonPair[] = [];
    for (let a = 0; a < ions.length; a++)
      for (let b = 0; b < ions.length; b++) {
        if (a === b) continue;
        const cat = ions[a]!.cat;
        const an = ions[b]!.an;
        if (!cat || !an) continue;
        const row = store.precip.get(`${cat}|${an}`);
        if (row) pairs.push({ row, from: [ions[a]!.id, ions[b]!.id] });
      }
    const decided = pairs.filter((p) => p.row.outcome);
    const interesting = decided.filter((p) => p.row.outcome !== "no visible change");
    if (pairs.length) {
      return {
        items,
        branch: "ions",
        pairs: decided.sort((x, y) => (y.row.outcome === "precipitate" ? 1 : 0) - (x.row.outcome === "precipitate" ? 1 : 0)),
        status: "rule",
        statusLine: interesting.length
          ? `${interesting.length} ion pair${interesting.length > 1 ? "s" : ""} with something to report, decided by Ksp and the curated rules`
          : decided.length
            ? `${decided.length} ion pairs, all of them "nothing you can see"`
            : "the ions are known but no pair of them is in the matrix",
        problems,
      };
    }
    return {
      items,
      branch: "nothing",
      status: "none",
      statusLine: "these are aqueous ions, but no cation/anion pair of them is in the matrix",
      problems,
    };
  }

  // 3. nothing applies, and the app says which part it tried
  return {
    items,
    branch: "nothing",
    status: "none",
    statusLine: unresolved.length
      ? `no curated reaction contains exactly these, and ${unresolved.join(", ")} is not in the ion table either`
      : "no curated reaction contains exactly this set of bottles",
    problems,
  };
}
