/** The notebook, prompt 11: save a mixture with its inputs and every verdict the app made.
 *
 *  Nothing here is a fresh calculation - a note is a *record* of what the app said at the time,
 *  next to the id of the data build it was said against. That is the whole design: reopen a note
 *  from an older build and the screen shows the saved verdict and whatever the current data now
 *  says, side by side, instead of pretending they are the same thing.
 */
import type { GuardCtx } from "./guard.js";
import type { MixResult } from "./mix.js";
import type { SpeciesRec, Store } from "../data/types.js";
import type { BenchItem } from "../state/app.js";
import { g } from "./format.js";

export const NOTEBOOK_APP = "chemlab-notebook";
export const NOTEBOOK_VERSION = 1;

export interface NoteNumber {
  label: string;
  value: string;
  unit: string;
  /** how the app got it, verbatim from the panel that computed it */
  basis: string;
}

export interface NoteBenchItem {
  species_id: string;
  /** copied for the day the id does not resolve any more: a note should still be readable */
  name: string;
  qty: number;
  unit: BenchItem["unit"];
  molarity?: number;
}

export interface NoteFinding {
  level: string;
  head: string;
  text: string;
  from: string;
}

export interface Note {
  id: string;
  saved_utc: string;
  title: string;
  data: { build_id: string; generated: string; species: number; reactions: number };
  ctx: GuardCtx;
  bench: NoteBenchItem[];
  verdict: {
    branch: string;
    status: string;
    status_line: string;
    reaction_id: string | null;
    reaction_name: string | null;
    match_note: string | null;
  };
  guard: { level: string; blocked: boolean; findings: NoteFinding[] };
  numbers: NoteNumber[];
}

export interface Export {
  app: typeof NOTEBOOK_APP;
  version: number;
  exported_utc: string;
  build_id: string;
  notes: Note[];
}

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

const stamp = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/** what the bench holds, the verdict it produced and the numbers that came out of it - frozen. */
export function captureNote(
  bench: BenchItem[],
  store: Store,
  ctx: GuardCtx,
  opts: { title?: string; mix?: MixResult; extras?: NoteNumber[] } = {},
): Note {
  const mix = opts.mix;
  const items: NoteBenchItem[] = bench.map((b) => ({
    species_id: b.species_id,
    name: (store.speciesById.get(b.species_id) as SpeciesRec | undefined)?.name ?? b.species_id,
    qty: b.qty,
    unit: b.unit,
    ...(b.molarity !== undefined ? { molarity: b.molarity } : {}),
  }));
  const numbers: NoteNumber[] = [...(opts.extras ?? [])];
  /* the guard hides the scale of some reactions and a notebook entry that quietly wrote the grams
     back in would undo that: a refusal is the result, here too */
  const hideScale = !!(mix?.guard as any)?.reaction?.hide_scale;
  const withheld = new Set(
    ((mix?.guard?.findings ?? []) as any[]).filter((f) => f.level === "block").flatMap((f) => f.species_ids ?? []),
  );
  if (hideScale)
    numbers.push({
      label: "quantities",
      value: "withheld",
      unit: "",
      basis: `the guard hides the scale for this reaction (${String((mix?.guard as any)?.reaction?.findings?.[0]?.head ?? "see the finding")}), so the notebook records the refusal instead of the numbers`,
    });
  for (const it of hideScale ? [] : mix?.items ?? []) {
    const sp = it.species;
    if (withheld.has(it.item.species_id) || (sp && withheld.has(sp.id))) {
      numbers.push({
        label: `${sp?.name ?? it.item.species_id}`,
        value: "withheld",
        unit: "",
        basis: "a blocking finding names this bottle, so its quantity is not recorded here either",
      });
      continue;
    }
    if (it.moles.moles !== null)
      numbers.push({
        label: `${sp?.name ?? it.item.species_id}`,
        value: g(it.moles.moles, 4),
        unit: "mol",
        basis: it.moles.basis,
      });
    else if (it.moles.basis)
      numbers.push({ label: `${sp?.name ?? it.item.species_id}`, value: "not worked out", unit: "", basis: it.moles.basis });
  }
  if (mix?.reaction) {
    const der: any = (mix.reaction as any).thermo_derived?.dH_rxn;
    if (der && typeof der.value === "number")
      numbers.push({ label: "ΔH of the reaction", value: g(der.value, 5), unit: der.units ?? "kJ per mole of reaction", basis: String(der.source ?? "the build's ledger") });
    const cur: any = (mix.reaction as any).thermo_curated?.dH;
    if (cur && typeof cur.value === "number")
      numbers.push({ label: "ΔH as curated", value: g(cur.value, 5), unit: cur.units ?? "kJ per mole of reaction", basis: String(cur.source ?? "curated") });
  }
  return {
    id: stamp(),
    saved_utc: now(),
    title: opts.title?.trim() || `${items.map((i) => i.name).join(" + ") || "empty bench"}`,
    data: {
      build_id: String(store.buildId ?? ""),
      generated: String(store.dataGenerated ?? ""),
      species: store.counts?.species ?? 0,
      reactions: store.counts?.reactions ?? 0,
    },
    ctx: { ...ctx },
    bench: items,
    verdict: {
      branch: mix?.branch ?? "empty",
      status: mix?.status ?? "none",
      status_line: mix?.statusLine ?? "no mix was decided when this was saved",
      reaction_id: mix?.reaction?.id ?? null,
      reaction_name: mix?.reaction?.name ?? null,
      match_note: mix?.matchNote ?? null,
    },
    guard: {
      level: mix?.guard?.level ?? "clear",
      blocked: !!mix?.guard?.blocked,
      findings: (mix?.guard?.findings ?? []).map((f) => ({ level: f.level, head: f.head, text: f.text, from: f.from })),
    },
    numbers,
  };
}

export function encodeNotes(notes: Note[], buildId: string): string {
  const out: Export = { app: NOTEBOOK_APP, version: NOTEBOOK_VERSION, exported_utc: now(), build_id: buildId, notes };
  return JSON.stringify(out, null, 1);
}

export interface Decoded {
  notes: Note[];
  problems: string[];
  /** notes made against a different data build than the app is showing now */
  stale: string[];
  header: { exported_utc: string | null; build_id: string | null; version: number | null; app: string | null };
}

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : d);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && Number.isFinite(Number(v)) ? Number(v) : d);

/** read a notebook file back. It never throws: anything it cannot make sense of is reported as a
 *  problem with the note it applies to, because the user's only copy of their results should not
 *  depend on this app being generous about a hand-edited file. */
export function decodeNotes(text: string, currentBuildId?: string | null): Decoded {
  const problems: string[] = [];
  const stale: string[] = [];
  let doc: any;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return { notes: [], problems: [`this is not JSON: ${String((e as Error)?.message ?? e).slice(0, 160)}`], stale, header: { exported_utc: null, build_id: null, version: null, app: null } };
  }
  const header = {
    exported_utc: doc?.exported_utc ?? null,
    build_id: doc?.build_id ?? null,
    version: typeof doc?.version === "number" ? doc.version : null,
    app: doc?.app ?? null,
  };
  let list: any[] = [];
  if (Array.isArray(doc)) list = doc;
  else if (Array.isArray(doc?.notes)) list = doc.notes;
  else if (Array.isArray(doc?.entries)) list = doc.entries;
  else problems.push("no notes array in this file: it is not a ChemLab notebook export");
  if (doc && !Array.isArray(doc) && doc.app !== NOTEBOOK_APP)
    problems.push(`the file says it is from "${str(doc.app, "nothing")}", not from ${NOTEBOOK_APP}`);
  if (header.version !== null && header.version > NOTEBOOK_VERSION)
    problems.push(`written by notebook version ${header.version}; this app reads up to ${NOTEBOOK_VERSION}, so fields may be missing`);

  const notes: Note[] = [];
  list.forEach((n: any, i) => {
    const label = `note ${i + 1}${n?.title ? ` (“${n.title}”)` : ""}`;
    if (!n || typeof n !== "object") {
      problems.push(`${label}: not an object, dropped`);
      return;
    }
    const benchIn = Array.isArray(n.bench) ? n.bench : [];
    if (!benchIn.length) problems.push(`${label}: no substances on it, so reopening it will leave the bench empty`);
    const note: Note = {
      id: str(n.id, `imported-${i}`),
      saved_utc: str(n.saved_utc, "unknown"),
      title: str(n.title, "untitled note"),
      data: {
        build_id: str(n?.data?.build_id),
        generated: str(n?.data?.generated),
        species: num(n?.data?.species),
        reactions: num(n?.data?.reactions),
      },
      ctx: {
        hood: !!n?.ctx?.hood,
        supervised: !!n?.ctx?.supervised,
        room_flammable_mL: Math.max(0, num(n?.ctx?.room_flammable_mL)),
      },
      bench: benchIn.map((b: any) => ({
        species_id: str(b?.species_id),
        name: str(b?.name, str(b?.species_id, "?")),
        qty: num(b?.qty),
        unit: (["g", "mol", "mL", "L"].includes(str(b?.unit)) ? str(b?.unit) : "g") as BenchItem["unit"],
        ...(b?.molarity !== undefined && b?.molarity !== null ? { molarity: num(b.molarity) } : {}),
      })),
      verdict: {
        branch: str(n?.verdict?.branch, "empty"),
        status: str(n?.verdict?.status, "none"),
        status_line: str(n?.verdict?.status_line, "no verdict was recorded"),
        reaction_id: n?.verdict?.reaction_id ? str(n.verdict.reaction_id) : null,
        reaction_name: n?.verdict?.reaction_name ? str(n.verdict.reaction_name) : null,
        match_note: n?.verdict?.match_note ? str(n.verdict.match_note) : null,
      },
      guard: {
        level: str(n?.guard?.level, "clear"),
        blocked: !!n?.guard?.blocked,
        findings: (Array.isArray(n?.guard?.findings) ? n.guard.findings : []).map((f: any) => ({
          level: str(f?.level, "note"),
          head: str(f?.head, "(no heading)"),
          text: str(f?.text),
          from: str(f?.from, "an older note format"),
        })),
      },
      numbers: (Array.isArray(n?.numbers) ? n.numbers : []).map((x: any) => ({
        label: str(x?.label, "a number"),
        value: str(x?.value, "?"),
        unit: str(x?.unit),
        basis: str(x?.basis, "no basis was recorded"),
      })),
    };
    for (const b of note.bench) if (!b.species_id) problems.push(`${label}: a substance has no id, so it cannot be put back on the bench`);
    if (currentBuildId && note.data.build_id && note.data.build_id !== currentBuildId) {
      stale.push(note.id);
      problems.push(`${label}: written against data build ${note.data.build_id.slice(0, 12)}, this app is on ${String(currentBuildId).slice(0, 12)}`);
    }
    notes.push(note);
  });
  return { notes, problems, stale, header };
}

/** the one line the list shows */
export function summarizeNote(n: Note): string {
  const parts = n.bench.map((b) => `${b.name} ${g(b.qty, 4)}${b.unit === "mol" ? " mol" : b.unit}`);
  return `${n.verdict.status === "none" ? "nothing decided" : n.verdict.status} · ${parts.join(" + ") || "an empty bench"}`;
}

/** what to put back on the bench when a note is reopened */
export function noteToBench(n: Note): BenchItem[] {
  return n.bench
    .filter((b) => b.species_id)
    .slice(0, 4)
    .map((b) => ({ species_id: b.species_id, qty: b.qty, unit: b.unit, ...(b.molarity !== undefined ? { molarity: b.molarity } : {}) }));
}

/** is this note's data older than the app's? */
export function noteStale(n: Note, currentBuildId: string | null | undefined): boolean {
  if (!currentBuildId || !n.data.build_id) return false;
  return n.data.build_id !== currentBuildId;
}
