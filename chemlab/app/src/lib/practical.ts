/** The practical-work layer, prompt 14: the schemes, techniques, kits and the syllabus index.
 *
 *  Two rules matter most here. (1) Every piece of glassware is quoted with the tolerance the register
 *  carries, and an item the register does not have is listed as a gap rather than quietly dropped.
 *  (2) No procedure is offered for a record the guard blocks, and no quantity is invented: the
 *  syllabus entries name reagents, not amounts, so the bench is handed the bottle at the app's usual
 *  starting amount and told so in words.
 */
import type { Store } from "../data/types.js";
import { g, subs } from "./format.js";
import { DEFAULT_CTX, guardReaction } from "./guard.js";

export interface ApparatusRef {
  /** what the data wrote, kept whatever resolves */
  raw: string;
  /** the register id, or null when the register has never heard of it */
  id: string | null;
  label: string;
  kind: string | null;
  note: string | null;
  /** the tolerance in the register's own words and number */
  tolerance: string | null;
  graduated: boolean | null;
  capacity: string | null;
  /** which table it came from, because only one of them carries cited figures */
  from: "tables.apparatus" | "tables.glassware" | null;
}

interface Register {
  byKey: Map<string, { rec: any; from: ApparatusRef["from"] }>;
  byName: Map<string, { rec: any; from: ApparatusRef["from"] }>;
}

const regCache = new WeakMap<Store, Register>();

function register(store: Store): Register {
  const hit = regCache.get(store);
  if (hit) return hit;
  const byKey = new Map<string, { rec: any; from: ApparatusRef["from"] }>();
  const byName = new Map<string, { rec: any; from: ApparatusRef["from"] }>();
  const put = (id: string, name: string | undefined, rec: any, from: ApparatusRef["from"]) => {
    if (id) byKey.set(id.toLowerCase(), { rec, from });
    if (name) byName.set(String(name).toLowerCase(), { rec, from });
  };
  const apps = (store.doc.tables?.apparatus ?? {}) as any;
  if (Array.isArray(apps)) for (const x of apps) put(String(x?.id ?? ""), x?.name, x, "tables.apparatus");
  else for (const [k, v] of Object.entries<any>(apps)) put(k, v?.name, v, "tables.apparatus");
  const glass = (store.doc.tables?.glassware ?? []) as any;
  if (Array.isArray(glass)) for (const x of glass) put(String(x?.id ?? ""), x?.name, x, "tables.glassware");
  else for (const [k, v] of Object.entries<any>(glass)) put(k, v?.name, v, "tables.glassware");
  const out = { byKey, byName };
  regCache.set(store, out);
  return out;
}

/** ± and mL, or the null the register carries — never a made-up precision */
function tolText(rec: any): string | null {
  const t = rec?.tolerance_mL;
  if (t === null || t === undefined) return null;
  const v = typeof t === "object" ? t.value : t;
  if (typeof v !== "number") return null;
  const unit = (typeof t === "object" && t.units) || "mL";
  const src = typeof t === "object" && t.source ? ` · ${t.source}` : "";
  return `± ${g(v, 2)} ${unit} on its own volume${src}`;
}

function capacityText(rec: any): string | null {
  const c = rec?.capacity_mL;
  if (c === null || c === undefined) return null;
  const v = typeof c === "object" ? c.value : c;
  if (typeof v !== "number") return null;
  const unit = (typeof c === "object" && c.units) || "mL";
  const grad = typeof rec?.graduation_mL === "number" ? `, graduated every ${g(rec.graduation_mL, 2)} ${unit}` : "";
  return `${g(v, 4)} ${unit}${grad}`;
}

export function apparatusRef(store: Store, raw: string): ApparatusRef {
  const key = raw.trim().toLowerCase();
  const found = register(store).byKey.get(key) ?? register(store).byName.get(key);
  const rec = found?.rec;
  if (!rec)
    return { raw, id: null, label: raw.trim(), kind: null, note: null, tolerance: null, graduated: null, capacity: null, from: null };
  return {
    raw,
    id: register(store).byKey.has(key) ? Object.keys(store.doc.tables?.apparatus ?? {}).find((k) => k.toLowerCase() === key) ?? raw.trim() : raw.trim(),
    label: String(rec.name ?? raw.trim()),
    kind: rec.kind ? String(rec.kind) : null,
    note: rec.note ? String(rec.note) : null,
    tolerance: tolText(rec),
    graduated: typeof rec.graduated === "boolean" ? rec.graduated : null,
    capacity: capacityText(rec),
    from: found?.from ?? null,
  };
}

/** A technique may name its glassware as a list of ids *or* as a sentence — "porcelain dish +
 *  inverted funnel + cotton plug". Both are read; nothing is guessed. */
export function apparatusList(store: Store, spec: unknown): { items: ApparatusRef[]; unregistered: string[]; wrote_ids: boolean } {
  const raws: string[] = [];
  if (Array.isArray(spec)) {
    for (const x of spec as unknown[]) if (typeof x === "string" && x.trim()) raws.push(x.trim());
  } else if (typeof spec === "string") {
    for (const part of (spec as string).split(/\s*[+\n,]\s*/)) if (part.trim()) raws.push(part.trim());
  }
  const items: ApparatusRef[] = [];
  const unregistered: string[] = [];
  for (const raw of raws) {
    const ref = apparatusRef(store, raw);
    if (ref.id) items.push(ref);
    else unregistered.push(raw);
  }
  return { items, unregistered, wrote_ids: Array.isArray(spec) };
}

/** the reagents named inside a sentence of English, matched only through the data's own formula
 *  index — a token that is not a formula in the warehouse stays plain text. The index is keyed by
 *  the formula as written ("Ag2CrO4"), so both a case-insensitive and a subscript-stripped lookup go
 *  through it; nothing here invents an id from a name it likes the look of. */
const SUB = "₀₁₂₃₄₅₆₇₈₉";
const flat = (x: string) =>
  String(x ?? "")
    .replace(/[₀-₉]/g, (c) => String(SUB.indexOf(c)))
    .replace(/\((?:aq|s|l|g|soln|sln|conc|dil)\)/gi, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase();

/** A token-to-bottle map built from the species records themselves: their written formula, their
 *  Hill formula, and the warehouse's own `index.by_formula`. Three names for one substance, all in
 *  the data, and no lookup by anything as loose as a name. */
interface FIndex {
  map: Map<string, string[]>;
}
const indexCache = new WeakMap<Store, FIndex>();

function formulaIndex(store: Store): FIndex {
  const hit = indexCache.get(store);
  if (hit) return hit;
  const map = new Map<string, string[]>();
  const add = (key: string, id: string) => {
    if (!key) return;
    const cur = map.get(key) ?? [];
    if (!cur.includes(id)) map.set(key, [...cur, id]);
  };
  for (const sp of store.doc.species ?? []) {
    const id = String((sp as any).id);
    add(flat((sp as any).formula_written), id);
    add(flat((sp as any).formula), id);
    add(flat((sp as any).hill_formula), id);
  }
  for (const [k, ids] of Object.entries<any>((store.doc.index?.by_formula ?? {}) as any)) for (const id of ids ?? []) add(flat(k), String(id));
  const out = { map };
  indexCache.set(store, out);
  return out;
}

const stateHint = (text: string) => (/gas|fumes|vapou?r|evolve/i.test(text) ? "g" : /\bdilut|aque|solution|in water\b/i.test(text) ? "aq" : null);

export interface FoundSpecies {
  id: string;
  name: string;
  label: string;
  formula: string;
  strength: string | null;
  alternatives: string[];
  /** the token in the sentence that produced this, so the link can be checked by a human */
  says: string;
  /** what the record says the bottle is, so a gas/solution disagreement is visible on screen */
  state: string | null;
  /** the sentence and the bottle disagree about strength, and the app says which way */
  mismatch: string | null;
}

export function speciesInText(store: Store, text: string): FoundSpecies[] {
  const { map } = formulaIndex(store);
  const bottles = ((store.doc.lab?.stock_bottles ?? []) as any[]) || [];
  const out: FoundSpecies[] = [];
  const seen = new Set<string>();
  for (const m of (text || "").matchAll(/[A-Z][A-Za-z0-9()]*[A-Za-z0-9]/g)) {
    const tok = m[0].replace(/[.,;:]+$/, "");
    if (tok.length < 2 || seen.has(tok)) continue;
    const ids = map.get(flat(tok));
    if (!ids || !ids.length) continue;
    seen.add(tok);
    const hint = stateHint(text);
    const pick =
      (hint ? ids.find((id) => String((store.speciesById.get(id) as any)?.state ?? "") === hint) : undefined) ??
      (hint === "aq" ? ids.find((id) => /_aq$|_soln$|_sol$/.test(id)) : undefined) ??
      ids[0];
    const sp = store.speciesById.get(pick) as any;
    if (!sp) continue;
    const wantAq = hint === "aq";
    const bottle = bottles.find((b) => b?.species_id === pick);
    const strength = bottle
      ? `${String(bottle.label ?? "")}${typeof bottle.molarity === "number" ? ` · ${g(bottle.molarity, 4)} M` : ""}${
          typeof bottle.percent_w_w === "number" ? ` · ${g(bottle.percent_w_w, 3)} % w/w` : ""
        }`
      : null;
    out.push({
      id: pick,
      name: String(sp.name ?? pick),
      label: subs(String(sp.formula_written ?? sp.formula ?? pick)),
      formula: String(sp.formula_written ?? sp.formula ?? ""),
      strength,
      alternatives: ids.filter((id) => id !== pick && store.speciesById.has(id)),
      says: tok,
      state: (sp as any).state ? String((sp as any).state) : null,
      mismatch:
        wantAq && /\bconcentrat/i.test(String(bottle?.label ?? ""))
          ? `the text asks for dilute ${tok}; the shelf's bottle is ${String(bottle.label).replace(/^\w+, /, "")}${
              typeof bottle.molarity === "number" ? ` at ${g(bottle.molarity, 4)} M` : ""
            } — dilute it with the calculator before you use it, and the app will not pretend the bottle is what the text asked for`
          : null,
    });
    if (out.length >= 6) break;
  }
  return out;
}

/* ------------------------------------------------------------------ the qualitative schemes */

/** the data writes these fields as a sentence, a list of sentences or a dict of them; the last
 *  case has a key worth showing (which ion the test belongs to), so it is not flattened away */
export function prose(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(prose).filter(Boolean).join("; ");
  if (typeof v === "object") return Object.entries<any>(v).map(([k, x]) => `${k}: ${prose(x)}`).join("; ");
  return String(v);
}

export interface ConfirmItem {
  /** the ion the test answers for, when the data keys it that way */
  for: string | null;
  text: string;
}

export function confirmItems(v: unknown): ConfirmItem[] {
  if (Array.isArray(v)) return v.map((x) => ({ for: null, text: prose(x) })).filter((x) => x.text);
  if (v && typeof v === "object") return Object.entries<any>(v).map(([k, x]) => ({ for: k, text: prose(x) })).filter((x) => x.text);
  const one = prose(v);
  return one ? [{ for: null, text: one }] : [];
}

export interface SchemeStep {
  group: string;
  reagent: string;
  reagent_species: {
    id: string;
    label: string;
    says: string;
    state: string | null;
    strength: string | null;
    mismatch: string | null;
    alternatives: string[];
  }[];
  precipitate: { formula: string; look: string; id: string | null; name: string | null }[];
  gas: string | null;
  why: string | null;
  confirm: ConfirmItem[];
  /** the reaction records the shelf has for this step, so a scheme is not decoration */
  reactions: { id: string; name: string }[];
}

const rxBySpecies = (store: Store, ids: string[], limit = 4) => {
  const out: { id: string; name: string }[] = [];
  const byId = new Set((store.doc.reactions ?? []).map((r) => r.id));
  for (const r of store.doc.reactions ?? []) {
    const terms = [...(r.reactants ?? []), ...(r.products ?? [])] as any[];
    if (ids.some((id) => terms.some((t) => t?.species_id === id))) {
      if (byId.has(r.id)) out.push({ id: r.id, name: r.name });
      if (out.length >= limit) break;
    }
  }
  return out;
};

export function cationScheme(store: Store): SchemeStep[] {
  const raw = (store.doc.lab?.cation_scheme ?? {}) as Record<string, any>;
  return Object.entries(raw).map(([group, v]: [string, any]) => {
    const reagentText = prose(v?.reagent);
    const ppt = v?.precipitate;
    const precipitate: { formula: string; look: string }[] = Array.isArray(ppt)
      ? ppt.map((x: any) => ({ formula: prose(x?.formula ?? x), look: prose(x?.look ?? x?.appearance ?? "") }))
      : ppt && typeof ppt === "object"
        ? Object.entries<any>(ppt).map(([formula, look]) => ({ formula, look: prose(look) }))
        : ppt
          ? [{ formula: prose(ppt), look: "" }]
          : [];
    const found = speciesInText(store, reagentText);
    const species = found.map((x) => ({
      id: x.id,
      label: x.name,
      says: x.says,
      state: x.state,
      strength: x.strength,
      mismatch: x.mismatch,
      alternatives: x.alternatives,
    }));
    const pptSpecies = precipitate.map((p) => speciesInText(store, p.formula)[0]).filter(Boolean);
    const ids = [...species.map((x) => x.id), ...precipitate.map((p) => p.formula.toLowerCase().replace(/[^a-z0-9]/g, ""))];
    return {
      group,
      reagent: reagentText || "no reagent named",
      reagent_species: species,
      precipitate: precipitate.map((p, i) => ({ ...p, id: pptSpecies[i]?.id ?? null, name: pptSpecies[i]?.name ?? null })),
      gas: v?.gas ? prose(v.gas) : null,
      why: v?.why ? prose(v.why) : null,
      confirm: confirmItems(v?.confirm),
      reactions: rxBySpecies(store, ids),
    };
  });
}

export interface AnionBlock {
  block: string;
  tests: { anion: string; observation: string }[];
}

export function anionScheme(store: Store): AnionBlock[] {
  const raw = (store.doc.lab?.anion_scheme ?? {}) as Record<string, any>;
  return Object.entries<any>(raw).map(([block, tests]) => ({
    block,
    tests: Object.entries<any>(tests ?? {}).map(([anion, observation]) => ({ anion, observation: prose(observation) })),
  }));
}

export interface OrganicTest {
  group: string;
  reagent: string;
  positive: string;
  timescale: string | null;
  caution: string | null;
  reagent_species: { id: string; label: string; says: string; state: string | null }[];
  /** the mismatch this app can actually see: a "dilute" instruction aimed at a concentrated bottle */
  strength_note: string | null;
}

export function organicTests(store: Store): OrganicTest[] {
  const rows = (store.doc.lab?.organic_tests ?? []) as any[];
  return rows.map((t) => {
    const reagent = prose(t?.reagent);
    const found = speciesInText(store, reagent);
    return {
      group: prose(t?.group),
      reagent,
      positive: prose(t?.positive),
      timescale: t?.timescale ? prose(t.timescale) : null,
      caution: t?.caution ? prose(t.caution) : null,
      reagent_species: found.map((x) => ({ id: x.id, label: x.name, says: x.says, state: x.state })),
      strength_note: found.find((x) => x.mismatch)?.mismatch ?? null,
    };
  });
}

export function paperTests(store: Store): { name: string; how: string; positive: string; note: string }[] {
  return ((store.doc.lab?.paper_tests ?? []) as any[]).map((p) => ({
    name: prose(p?.name),
    how: prose(p?.how),
    positive: prose(p?.positive),
    note: prose(p?.note),
  }));
}

/* ------------------------------------------------------------------ techniques and kits */

export interface Technique {
  id: string;
  name: string;
  goal: string;
  steps: string[];
  apparatus: ApparatusRef[];
  unregistered: string[];
  /** what the technique wrote as prose instead of register ids, kept and labelled as such */
  prose: string[];
  wrote_ids: boolean;
  extra: { label: string; text: string }[];
  kits: string[];
  experiments: { group: string; name: string }[];
  reactions: { id: string; name: string }[];
  /** what the guard says about the reactions this technique is done with */
  blocked: string[];
}

const EXTRA_LABELS: [string, string][] = [
  ["physics", "why it works"],
  ["recovery_model", "the arithmetic of a wash"],
  ["rule", "the rule of thumb, from the data"],
  ["failure", "how it usually fails"],
  ["gotchas", "the traps"],
  ["readings", "what to record"],
  ["error_budget", "where the error comes from"],
  ["concordance", "what counts as agreeing"],
  ["quantities", "the quantities the data names"],
  ["safety", "safety"],
  ["examples", "done with"],
  ["methods", "the methods"],
  ["tlc", "by chromatography"],
  ["paper", "on paper"],
];

export function techniques(store: Store): Technique[] {
  const rows = (store.doc.tables?.techniques ?? []) as any[];
  const kitMap = (store.doc.lab?.kits ?? {}) as Record<string, string[]>;
  const cur = (store.doc.lab?.curriculum ?? {}) as Record<string, Record<string, any>>;
  return rows.map((t) => {
    const { items, unregistered } = apparatusList(store, t?.apparatus);
    const named = prose(t?.apparatus ?? "");
    // a technique that wrote its glassware as a sentence never claimed a register id, so its
    // unresolved words are printed but not counted as gaps in the register
    const as_prose = !named_list(t?.apparatus);
    // a kit "has" a technique when the two name the same registered piece of glassware
    const ids = new Set(items.map((x) => String(x.id).toLowerCase()));
    const kits = Object.entries(kitMap)
      .filter(([, list]) => (list ?? []).some((x) => {
        const r = apparatusRef(store, String(x));
        return r.id !== null && ids.has(String(r.id).toLowerCase());
      }))
      .map(([k]) => k);
    const experiments = Object.entries<any>(cur).flatMap(([group, exps]) =>
      Object.entries<any>(exps ?? {})
        .filter(([, e]) =>
          ((e?.app ?? []) as any[]).some((a) => {
            const r = apparatusRef(store, String(a));
            return r.id !== null && ids.has(String(r.id).toLowerCase());
          }),
        )
        .map(([name]) => ({ group, name })),
    );
    const reactions = ((store.doc.reactions ?? []) as any[])
      .filter(
        (r) =>
          (r.categories ?? []).includes(t?.id) ||
          (r.tags ?? []).includes(t?.id) ||
          (safetyApp(r) ?? []).some((a: any) => ids.has(String(apparatusRef(store, String(a)).id ?? "@@").toLowerCase())),
      )
      .slice(0, 8)
      .map((r) => ({ id: r.id, name: r.name }));
    const blocked = reactions
      .filter((r) => guardReaction(store.reactionById.get(r.id) as any, store, DEFAULT_CTX).suppress_route)
      .map((r) => r.name);
    return {
      id: String(t?.id ?? ""),
      name: String(t?.name ?? t?.id ?? ""),
      goal: String(t?.goal ?? ""),
      steps: Array.isArray(t?.steps) ? t.steps.map(prose) : t?.steps ? [prose(t.steps)] : [],
      apparatus: items,
      // a sentence that names no register entry is still worth printing, once, in its own words
      unregistered: as_prose ? [] : unregistered,
      prose: as_prose ? (named ? [named] : []) : [],
      wrote_ids: !as_prose,
      extra: EXTRA_LABELS.filter(([k]) => t?.[k] !== undefined && t?.[k] !== null && !(typeof t[k] === "boolean")).map(([k, label]) => ({
        label,
        text: prose(t[k]),
      })),
      kits,
      experiments,
      reactions,
      blocked,
    };
  });
}

const safetyApp = (r: any): string[] => (r?.safety?.apparatus ?? []) as string[];

export interface Kit {
  id: string;
  name: string;
  items: ApparatusRef[];
  unregistered: string[];
  with_measures: number;
  techniques: string[];
}

export function kits(store: Store): Kit[] {
  const raw = (store.doc.lab?.kits ?? {}) as Record<string, string[]>;
  const techs = (store.doc.tables?.techniques ?? []) as any[];
  return Object.entries<any>(raw).map(([id, list]) => {
    const { items, unregistered } = apparatusList(store, list ?? []);
    const words = String(id).split(/[-\s]+/).filter((w) => w.length > 4);
    return {
      id,
      name: String(id).replace(/-/g, " "),
      items,
      unregistered,
      with_measures: items.filter((x) => x.tolerance).length,
      techniques: techs.filter((t) => words.some((w) => String(t?.id ?? "").includes(w) || String(t?.name ?? "").toLowerCase().includes(w))).map((t) => String(t.name)),
    };
  });
}

/* ------------------------------------------------------------------ the syllabus index */

export interface Experiment {
  group: string;
  name: string;
  minutes: number | null;
  note: string | null;
  safety: string | null;
  reactions: { id: string; name: string; missing: boolean; route: boolean; why_no_route: string | null }[];
  species: { id: string; name: string; label: string; blocked: string | null }[];
  withheld: number;
  apparatus: ApparatusRef[];
  unregistered: string[];
}

export function curriculum(store: Store): { group: string; experiments: Experiment[] }[] {
  const cur = (store.doc.lab?.curriculum ?? {}) as Record<string, Record<string, any>>;
  return Object.entries<any>(cur).map(([group, exps]) => ({
    group,
    experiments: Object.entries<any>(exps ?? {}).map(([name, e]) => {
      const rxIds: string[] = (e?.react ?? []) as string[];
      const guarded = rxIds.map((id) => {
        const rec = store.reactionById.get(id) as any;
        const gv = rec ? guardReaction(rec, store, DEFAULT_CTX) : null;
        const stop = gv?.findings.find((f: any) => f.level === "block");
        return {
          id,
          name: String(rec?.name ?? id),
          missing: !rec,
          route: !rec ? false : !gv?.suppress_route,
          why_no_route: stop ? `${stop.head}${stop.text ? `: ${stop.text}` : ""}` : null,
          rec,
        };
      });
      const reactions = guarded.map(({ rec, ...rest }) => rest);
      const sp = new Map<string, { id: string; name: string; label: string; blocked: string | null }>();
      let withheld = 0;
      for (const { rec, route, why_no_route } of guarded) {
        if (!rec) continue;
        for (const t of (rec.reactants ?? []) as any[]) {
          const sid = t?.species_id;
          if (!sid || sp.has(sid)) continue;
          const rec2 = store.speciesById.get(sid) as any;
          if (!rec2) continue;
          if (!route) withheld += 1;
          sp.set(sid, { id: sid, name: String(rec2.name ?? sid), label: subs(String(rec2.formula_written ?? rec2.formula ?? sid)), blocked: route ? null : why_no_route ?? "the record's route is withheld, so no procedure is offered" });
        }
      }
      const { items, unregistered } = apparatusList(store, (e?.app ?? []) as string[]);
      return {
        group,
        name,
        minutes: typeof e?.time === "number" ? e.time : null,
        note: e?.note ? String(e.note) : null,
        safety: e?.safety ? String(e.safety) : null,
        reactions,
        species: [...sp.values()],
        withheld,
        apparatus: items,
        unregistered,
      };
    }),
  }));
}

/* ------------------------------------------------------------------ when it goes wrong */

export function troubleshooting(store: Store): { symptom: string; causes: string[]; fix: string; techniques: string[] }[] {
  const rows = (store.doc.lab?.troubleshooting ?? []) as any[];
  const techs = (store.doc.tables?.techniques ?? []) as any[];
  return rows.map((t) => {
    const text = `${t?.symptom ?? ""} ${t?.fix ?? ""} ${(t?.causes ?? []).join(" ")}`.toLowerCase();
    return {
      symptom: prose(t?.symptom),
      causes: Array.isArray(t?.causes) ? t.causes.map(prose) : t?.causes ? [prose(t.causes)] : [],
      fix: prose(t?.fix),
      techniques: techs.filter((x) => text.includes(String(x?.id ?? "@@").replace(/_/g, " ")) || text.includes(String(x?.name ?? "@@").toLowerCase())).map((x) => String(x.name)),
    };
  });
}

const named_list = (x: unknown) => Array.isArray(x);

/* ------------------------------------------------------------------ the audit the screen prints */

export interface Gap {
  where: string;
  ref: string;
  kind: "apparatus" | "reaction";
  detail: string;
}

export function practicalGaps(store: Store): Gap[] {
  const out: Gap[] = [];
  for (const t of techniques(store)) for (const u of t.unregistered) out.push({ where: `technique ${t.id}`, ref: u, kind: "apparatus", detail: "the technique named this id and the register has no row for it" });
  for (const k of kits(store)) for (const u of k.unregistered) out.push({ where: `kit ${k.id}`, ref: u, kind: "apparatus", detail: "the kit asks for it; tables.apparatus has no such row" });
  for (const grp of curriculum(store))
    for (const e of grp.experiments) {
      for (const u of e.unregistered) out.push({ where: `syllabus “${e.name.slice(0, 40)}”`, ref: u, kind: "apparatus", detail: "the entry asks for it; the register has no row" });
      for (const r of e.reactions) if (r.missing) out.push({ where: `syllabus “${e.name.slice(0, 40)}”`, ref: r.id, kind: "reaction", detail: "the syllabus names a reaction id the file does not have" });
    }
  return out;
}

/** one line per apparatus kind, for the shelf's "what is in this kit" text */
export function measuresIn(refs: ApparatusRef[]): string | null {
  const withTol = refs.filter((r) => r.tolerance);
  if (!withTol.length) return null;
  return `${withTol.length} of ${refs.length} pieces carry a tolerance in the register`;
}
