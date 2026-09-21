/** The safety guard, prompt 10.
 *
 *  Everything here is a lookup into what the shipped data already says, plus arithmetic on the
 *  quantities the user typed. The data carries the judgement; the app quotes it. That is why
 *  nearly every finding below has a `from` field naming the file and key it came from and a
 *  `text` that is the data's own words - if this file ever starts sounding like it knows chemistry
 *  on its own, that is the bug.
 *
 *  `safety_index.rule` is the policy the lists were built for, and the screens quote it verbatim:
 *  refuse a hard stop, refuse a hazard-5 reagent when there is no hood, warn otherwise.
 */
import type { ReactionRec, SpeciesRec, Store } from "../data/types.js";
import { toMoles, type Moles } from "./amounts.js";
import { g } from "./format.js";
import type { BenchItem } from "../state/app.js";

export interface GuardCtx {
  /** a working fume hood is available where this is being done */
  hood: boolean;
  /** a teacher or a chemist is standing there */
  supervised: boolean;
  /** flammable solvent already open in the room, not counting the bench */
  room_flammable_mL: number;
}

export const DEFAULT_CTX: GuardCtx = { hood: false, supervised: false, room_flammable_mL: 0 };

export type GuardLevel = "block" | "warn" | "note";

/** a policy number from `tables.safety_limits`, with its provenance and what the bench showed */
export interface LimitCheck {
  key: string;
  limit: number | null;
  units: string;
  source: string;
  confidence: string;
  note: string | null;
  measured: string;
  over: boolean;
  /** false when there was nothing to compare, which is not the same as being within a limit */
  checked: boolean;
}

export interface Finding {
  level: GuardLevel;
  head: string;
  /** the data's words, quoted */
  text: string;
  /** what the app does about it - again the data's words wherever the data has any */
  action?: string;
  /** which file and key this came from */
  from: string;
  ref_id?: string | null;
  species_ids?: string[];
  /** how a fuzzy match was resolved, printed so the user can disagree with it */
  via?: string;
  limit?: LimitCheck;
}

export interface Aid {
  key: string;
  text: string;
  why: string;
}

export interface Classified {
  cls: string;
  rule: string;
  why: string;
  via: string;
}

export interface Bottle {
  species_id: string;
  name: string;
  hazard_score: number | null;
  badge: "danger" | "warn" | "clear";
  pictograms: string[];
  h_codes: string[];
  findings: Finding[];
  grams: number | null;
  mL: number | null;
  first_aid: Aid[];
  waste: Classified[];
  storage: Classified[];
}

export interface ReactionGuard {
  id: string;
  name: string;
  danger_score: number | null;
  controls: string[];
  findings: Finding[];
  /** the app may show what happened, never how to make it happen */
  suppress_route: boolean;
  /** no quantities, no glassware list, no "run it" panel */
  hide_scale: boolean;
}

export interface GuardVerdict {
  level: "block" | "warn" | "clear";
  blocked: boolean;
  findings: Finding[];
  bottles: Bottle[];
  reaction: ReactionGuard | null;
  /** what the guard looked at, including the checks that came back clean */
  checks: string[];
  /** control tokens in the data this app does not implement - never dropped silently */
  unknown_controls: string[];
  standing: string[];
  limits: LimitCheck[];
}

/* ------------------------------------------------------------------ vocabulary
 * The reaction records carry a control vocabulary in `safety.controls`. What each token obliges
 * the app to do is app-side policy, so it is written once, here. Any token not in this table is
 * collected into `unknown_controls` and shown on screen rather than being ignored.
 */
type ControlRule = { level: GuardLevel; what: string; route?: boolean; scale?: boolean };
const CONTROLS: Record<string, ControlRule> = {
  blocked: { level: "block", what: "the record exists; the reaction does not happen here", route: true, scale: true },
  "hard-stop-warning": { level: "block", what: "this is the mix that hospitalises people, so it is a warning and never a procedure", route: true, scale: true },
  "display-only": { level: "warn", what: "shown as a record of what somebody did, not as steps", route: true, scale: true },
  "video-only": { level: "warn", what: "there is a film of this; there is no bench version", route: true, scale: true },
  "reference-only": { level: "note", what: "reference text only", route: true, scale: true },
  "process-only": { level: "warn", what: "an industrial process, not a bench operation", route: true, scale: true },
  "display-step": { level: "note", what: "one step may be shown, the rest may not", route: true },
  "no-isolation": { level: "warn", what: "the product is not to be isolated, only observed in the tube", scale: true },
  "no-storage": { level: "warn", what: "make it, use it, destroy it the same day" },
  "fume-hood": { level: "warn", what: "the hood is not optional here" },
  restricted: { level: "warn", what: "restricted: a supervisor decides, not this app" },
  "plastic-vessel-only": { level: "warn", what: "glass is a reactant in this one" },
  "substitute-thioacetamide": { level: "note", what: "the sulfide comes from thioacetamide, generated in the tube, not from a bottle of H2S" },
  thioacetamide: { level: "note", what: "sulfide is supplied as thioacetamide, generated in the tube" },
};

/** what a control token obliges, or null when the app does not know that token */
export function controlRule(token: string): ControlRule | null {
  return CONTROLS[token.trim()] ?? null;
}

/** the whole vocabulary the app implements, so the screen can print it beside the counts */
export const CONTROL_VOCABULARY = Object.keys(CONTROLS).sort();

/* ------------------------------------------------------------------ reading a record */

/** an extras field the schema leaves open: a list of strings, one string, or a map of them */
function asStrings(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") return [v];
  if (v && typeof v === "object") return Object.values(v as Record<string, unknown>).map(String);
  return [];
}

/** every name-ish string a substance can be recognised by, lower-cased */
export function nameTokens(s: SpeciesRec): string[] {
  const any = s as any;
  const out = [s.name, s.formula_written ?? "", s.formula ?? "", ...asStrings(any.name_candidates), ...asStrings(any.alias), ...asStrings(any.reacts_with)];
  return out.filter(Boolean).map((x) => String(x).toLowerCase());
}

/** a short token has to be the formula, not a piece of one: "h2s" must not answer for H2SO4 */
const mentions = (s: SpeciesRec, word: string) => {
  const w = String(word).toLowerCase().trim();
  if (w.length < 3) return false;
  const toks = nameTokens(s);
  if (w.length < 4) return toks.some((t) => t === w || t.split(/[^a-z0-9]+/).includes(w));
  return toks.some((t) => t.includes(w));
};

const pictos = (s: SpeciesRec) => (s.ghs?.pictograms ?? []).map((p) => String(p).toLowerCase());
const hasPicto = (s: SpeciesRec, re: RegExp) => pictos(s).some((p) => re.test(p));
const hcodes = (s: SpeciesRec) => (s.ghs?.h_codes ?? []).map((h: any) => String(h.code));

const organic = (s: SpeciesRec) => !!s.elements && "C" in s.elements && s.kind !== "aqueous_ion";
export const isFlammable = (s: SpeciesRec) => hasPicto(s, /flamm/) || hcodes(s).some((c) => /^H22\d$/.test(c) || c === "H250" || c === "H251" || c === "H260");
export const isCorrosive = (s: SpeciesRec) => hasPicto(s, /corros/) || hcodes(s).some((c) => c === "H290" || c === "H314" || c === "H318");
export const isOxidiser = (s: SpeciesRec) => hasPicto(s, /oxid/) || s.role === "oxidiser" || hcodes(s).some((c) => c === "H270" || c === "H271" || c === "H272");
export const isToxic = (s: SpeciesRec) => hasPicto(s, /acute toxic|health hazard/) || (s.hazard_score ?? 0) >= 3;

/** why a record counts as flammable, printed whenever the flammable limit is quoted, because
 *  "ammonia solution" being in that list needs an explanation the user is entitled to. */
function flammableWhy(s: SpeciesRec): string {
  if (hasPicto(s, /flamm/)) return "the label carries the flammable pictogram";
  const c = hcodes(s).filter((x) => /^H22\d$/.test(x) || x === "H250" || x === "H251" || x === "H260");
  return c.length ? `the label carries ${c.join(", ")}` : "no flammability statement on the label";
}

/** the substances the guard treats as "small scale or hood": the data's own two lists plus any
 *  record whose hazard score reaches the top of the scale. Printed as a basis wherever used. */
export function guardWorthyIds(store: Store): Set<string> {
  const si: any = store.doc.safety_index ?? {};
  const out = new Set<string>([...(si.species_hazard5 ?? []), ...(si.species_ghs_danger_critical ?? [])]);
  for (const s of store.species) if ((s.hazard_score ?? 0) >= 5) out.add(s.id);
  return out;
}

/** the hazard label as the guard sees it - the same reading the badges use, so a screen cannot
 *  disagree with the verdict about what a bottle is */
export function hazardLabel(sp: SpeciesRec | null | undefined) {
  return {
    score: sp?.hazard_score ?? null,
    signal: sp?.ghs?.signal_word ?? null,
    pictograms: sp?.ghs?.pictograms ?? [],
    h_codes: (sp?.ghs?.h_codes ?? []).map((h: any) => ({ code: String(h.code), text: String(h.text ?? "") })),
    statements: (sp as any)?.hazard_statements ?? [],
  };
}

/* ------------------------------------------------------------------ one reaction */

export function guardReaction(rx: ReactionRec | null | undefined, store: Store, ctx: GuardCtx): ReactionGuard {
  if (!rx) return { id: "", name: "", danger_score: null, controls: [], findings: [], suppress_route: false, hide_scale: false };
  const si: any = store.doc.safety_index ?? {};
  const findings: Finding[] = [];
  let suppress = false;
  let hideScale = false;
  const on = (key: string) => ((si[key] ?? []) as string[]).includes(rx.id);

  /* one refusal, however many places the data says no - three findings saying the same thing
     would just teach the user to skim past them */
  const stop: string[] = [];
  if (on("reactions_hard_stopped")) stop.push("safety_index.reactions_hard_stopped");
  if ((rx as any).safety?.blocked) stop.push("reactions[].safety.blocked");
  const blocking = ((rx as any).safety?.controls ?? []).filter((t: string) => controlRule(t)?.level === "block");
  for (const t of blocking) stop.push(`reactions[].safety.controls "${t}"`);
  if (stop.length) {
    const ref = closestRefusal(store, rx);
    const words = blocking.map((t: string) => controlRule(t)!.what);
    findings.push({
      level: "block",
      head: ref ? `refused: ${ref.topic}` : "refused by the safety layer",
      text: [ref ? ref.policy : "", ...words, (rx as any).safety?.blocked && !ref ? "this record carries safety.blocked: true" : ""].filter(Boolean).join(" ") || "the safety index puts this reaction on the hard-stop list",
      action: ref ? `what the app shows instead: ${ref.what_is_shown_instead}` : "the record stays readable: what happened, what it costs in energy, what it did to people",
      from: stop.join(" + "),
      ref_id: rx.id,
    });
    suppress = true;
    hideScale = true;
  }
  if (on("reactions_restricted"))
    findings.push({
      level: ctx.supervised ? "note" : "warn",
      head: "restricted",
      text: `the index marks this restricted${ctx.supervised ? " - you have said a supervisor is here, and the decision stays theirs" : " - and you have not said a supervisor is here"}`,
      from: "safety_index.reactions_restricted",
      ref_id: rx.id,
    });
  if (on("reactions_needing_hood"))
    findings.push({
      level: ctx.hood ? "note" : "warn",
      head: "needs a fume hood",
      text: ctx.hood ? "the index says this one needs a hood, and you have said there is one" : "the index says this one needs a hood, and the room you described has none",
      from: "safety_index.reactions_needing_hood",
      ref_id: rx.id,
    });

  for (const token of (rx as any).safety?.controls ?? []) {
    const rule = controlRule(token);
    if (!rule) continue; // surfaced through unknown_controls, not dropped
    if (rule.level === "block" && stop.length) continue; // already folded into the refusal above
    findings.push({
      level: rule.level,
      head: `control: ${token}`,
      text: rule.what,
      from: "reactions[].safety.controls",
      ref_id: rx.id,
    });
    if (rule.route) suppress = true;
    if (rule.scale) hideScale = true;
  }

  const ds: number | null = (rx as any).safety?.danger_score ?? null;
  if (ds !== null)
    findings.push({
      level: ds >= 3 ? "warn" : "note",
      head: `danger ${ds}/5`,
      text: `the record's own danger score${(rx as any).safety?.max_scale ? `; the largest scale the record allows is ${(rx as any).safety.max_scale}` : "; the record sets no scale limit"}`,
      from: "reactions[].safety.danger_score",
      ref_id: rx.id,
    });

  return {
    id: rx.id,
    name: rx.name ?? rx.id,
    danger_score: ds,
    controls: (rx as any).safety?.controls ?? [],
    findings,
    suppress_route: suppress,
    hide_scale: hideScale,
  };
}

/** the refusal entry whose topic or examples reach this reaction, if one does */
function closestRefusal(store: Store, rx: ReactionRec): any | null {
  const list: any[] = (store.doc.lab as any)?.refusals ?? [];
  const hay = `${rx.name} ${(rx as any).tags ?? []} ${(rx as any).categories ?? []} ${rx.equation ?? ""}`.toLowerCase();
  for (const r of list) {
    const words = `${r.topic} ${r.examples}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 4);
    if (words.some((w) => hay.includes(w))) return r;
  }
  return null;
}

/* ------------------------------------------------------------------ one bottle */

export function guardSpecies(sp: SpeciesRec | null | undefined, store: Store, ctx: GuardCtx): {
  findings: Finding[];
  badge: Bottle["badge"];
  first_aid: Aid[];
  waste: Classified[];
  storage: Classified[];
} {
  const findings: Finding[] = [];
  if (!sp) return { findings, badge: "clear", first_aid: [], waste: [], storage: [] };
  const si: any = store.doc.safety_index ?? {};
  const five: string[] = si.species_hazard5 ?? [];
  const crit: string[] = si.species_ghs_danger_critical ?? [];

  if (sp.not_a_shelf_reagent)
    findings.push({
      level: "block",
      head: "not a shelf reagent",
      text: sp.shelf_block_reason ?? "the record is here to be read, not to be weighed out",
      action: "the sheet shows everything the record holds; the bench will not accept it and no quantity is ever printed for it",
      from: "species[].not_a_shelf_reagent",
      species_ids: [sp.id],
    });

  if (five.includes(sp.id))
    findings.push({
      level: ctx.hood ? "warn" : "block",
      head: "hazard 5 - the top of the scale",
      text: ctx.hood
        ? "the data's rule is to refuse a hazard-5 reagent when there is no hood. You have said there is one, so this is a warning and not a refusal - the scale limit still applies"
        : "the data's rule is explicit: a hazard-5 reagent without a hood is refused, not warned about",
      action: ctx.hood ? "weigh nothing above the no-hood gram limit even so" : "weigh nothing. the record below says what this is and what it has done to people",
      from: "safety_index.species_hazard5, with its rule",
      species_ids: [sp.id],
    });

  if (crit.includes(sp.id))
    findings.push({
      level: "warn",
      head: "on the GHS danger-critical list",
      text: `${crit.length} of the warehouse's ${store.species.length} records are on this list: the signal word is Danger and the hazard is one a home bench cannot control`,
      from: "safety_index.species_ghs_danger_critical",
      species_ids: [sp.id],
    });

  if ((sp.hazard_score ?? 0) >= 3 && !five.includes(sp.id))
    findings.push({
      level: "note",
      head: `hazard ${sp.hazard_score}/5`,
      text: "the curated score on the record. 5 is the top of the scale and exactly one substance in this warehouse carries it",
      from: "species[].hazard_score",
      species_ids: [sp.id],
    });

  return {
    findings,
    badge: findings.some((f) => f.level === "block") ? "danger" : findings.some((f) => f.level === "warn") ? "warn" : "clear",
    first_aid: firstAidFrom((store.doc.lab as any)?.emergency ?? {}, sp),
    waste: wasteFor(sp, store),
    storage: storageFor(sp, store),
  };
}

/* ------------------------------------------------------------------ the bench */

const mLof = (item: BenchItem) => (item.unit === "mL" ? item.qty : item.unit === "L" ? item.qty * 1000 : null);

interface BenchQty {
  item: BenchItem;
  species: SpeciesRec | undefined;
  moles: Moles;
  mL: number | null;
  grams: number | null;
  how: string;
}

/** grams and millilitres of what is on the bench, converting between the two with the density on
 *  the record and saying so when it had to */
function quantities(bench: BenchItem[], store: Store): BenchQty[] {
  return bench.map((item) => {
    const species = store.speciesById.get(item.species_id);
    const moles = toMoles(item, species, (store.doc.lab as any)?.stock_bottles ?? []);
    const direct = mLof(item);
    const den = (species as any)?.props_den?.value;
    let mL = direct;
    let grams = moles.grams;
    let how = moles.basis;
    if (mL === null && grams !== null && typeof den === "number" && den > 0) {
      mL = grams / den;
      how = `${how}; the volume is that mass over the density on the record (${g(den, 3)} g/cm3)`;
    }
    if (grams === null && mL !== null && typeof den === "number" && den > 0) {
      grams = mL * den;
      how = `${how}; the mass is that volume times the density on the record`;
    }
    return { item, species, moles, mL, grams, how };
  });
}

function provOf(store: Store, key: string): any {
  const t: any = (store.doc.tables as any)?.safety_limits?.[key];
  return t ?? null;
}

function limitCheck(
  store: Store,
  key: string,
  measured: number | null,
  measured_text: string,
  cmp: "over" | "under" = "over",
): LimitCheck | null {
  const p = provOf(store, key);
  if (!p) return null;
  const limit: number | null = typeof p.value === "number" ? p.value : null;
  const over = limit !== null && measured !== null ? (cmp === "over" ? measured > limit : measured < limit) : false;
  return {
    key,
    limit,
    units: p.units ?? "",
    source: p.source ?? "no source on this limit",
    confidence: p.confidence ?? "?",
    note: p.note ?? null,
    measured:
      limit === null
        ? "the table carries no number for this limit, so nothing was compared"
        : measured === null
          ? `cannot be checked: ${measured_text}`
          : `${measured_text}, against the ${g(limit, 3)}${p.units ? ` ${p.units}` : ""} the data sets`,
    over,
    checked: limit !== null && measured !== null,
  };
}

function limitFinding(l: LimitCheck, subject: string): Finding {
  const floor = /^min_/.test(l.key);
  if (l.limit === null)
    return {
      level: "note",
      head: `${l.key}: no number in the data`,
      text: `the limit table lists this with a null value, so the app has nothing to compare against and will not invent one${l.note ? ` (${l.note})` : ""}`,
      from: `tables.safety_limits.${l.key}`,
      limit: l,
    };
  if (!l.checked)
    return {
      level: "note",
      head: `${l.key}: nothing to check`,
      text: l.measured,
      from: `tables.safety_limits.${l.key}`,
      limit: l,
    };
  if (!l.over)
    return {
      level: "note",
      head: `${l.key}: within the limit`,
      text: l.measured,
      from: `tables.safety_limits.${l.key}`,
      limit: l,
    };
  return {
    level: "warn",
    head: `${l.key}: ${floor ? "below the minimum" : "over the limit"}`,
    text: `${l.measured}. ${subject}. ${l.note ?? ""}`.trim(),
    from: `tables.safety_limits.${l.key}`,
    limit: l,
  };
}

export function guardBench(bench: BenchItem[], store: Store, ctx: GuardCtx, rxId?: string | null): GuardVerdict {
  const findings: Finding[] = [];
  const checks: string[] = [];
  const unknown = new Set<string>();
  const qty = quantities(bench, store);
  const present = qty.map((q) => q.species).filter(Boolean) as SpeciesRec[];

  /* 1. the bottles */
  const bottles: Bottle[] = qty.map((q) => {
    const g2 = guardSpecies(q.species, store, ctx);
    findings.push(...g2.findings);
    return {
      species_id: q.species?.id ?? q.item.species_id,
      name: q.species?.name ?? q.item.species_id,
      hazard_score: q.species?.hazard_score ?? null,
      badge: g2.badge,
      pictograms: (q.species?.ghs?.pictograms ?? []) as string[],
      h_codes: (q.species?.ghs?.h_codes ?? []).map((h: any) => String(h.code)),
      findings: g2.findings,
      grams: q.grams,
      mL: q.mL,
      first_aid: g2.first_aid,
      waste: g2.waste,
      storage: g2.storage,
    };
  });
  checks.push(
    bottles.length
      ? `${bottles.length} bottle${bottles.length === 1 ? "" : "s"} against the five safety lists and the record's own hazard score`
      : "nothing is on the bench, so there is nothing to guard",
  );

  /* 2. the reaction the bench decided on, if any */
  let reaction: ReactionGuard | null = null;
  if (rxId) {
    const rx = store.reactionById?.get?.(rxId) ?? store.reactions.find((r) => r.id === rxId) ?? null;
    reaction = guardReaction(rx, store, ctx);
    findings.push(...reaction.findings);
    for (const t of (rx as any)?.safety?.controls ?? []) if (!controlRule(t)) unknown.add(t);
    checks.push(`the reaction record ${reaction.id} and its ${reaction.controls.length} control token(s)`);
  }

  /* 3. what the things on the bench do to each other */
  const rules: any[] = (store.doc.lab as any)?.mixing_rules ?? [];
  const fired: string[] = [];
  for (const rule of rules) {
    const a = matchSide(rule.with, present);
    const b = matchSide(rule.and, present);
    if (!a || !b || a.sp.id === b.sp.id) continue; // one bottle cannot react with itself
    fired.push(`${rule.with} + ${rule.and}`);
    const action = String(rule.app_action ?? "");
    const refuses = /refuse|block|never|don't run|no cyanide|not in the app/i.test(action);
    findings.push({
      level: rule.severity === "critical" && refuses ? "block" : "warn",
      head: `${rule.with} + ${rule.and}`,
      text: rule.what_happens,
      action,
      from: "lab.mixing_rules",
      via: `${rule.with} ← ${a.sp.name} (${a.via}); ${rule.and} ← ${b.sp.name} (${b.via})`,
      species_ids: [a.sp.id, b.sp.id],
    });
  }
  checks.push(
    fired.length
      ? `${fired.length} of the ${rules.length} mixing rules in the data match what is on the bench`
      : `all ${rules.length} mixing rules in the data were tested against these bottles and none of them match`,
  );

  /* 4. the policy limits, against the quantities actually typed */
  const limits: LimitCheck[] = [];
  const worthy = guardWorthyIds(store);
  const risky = qty.filter((q) => q.species && (worthy.has(q.species.id) || (q.species.hazard_score ?? 0) >= 3));
  const risky_grams = risky.every((q) => q.grams !== null) ? risky.reduce((a, q) => a + (q.grams ?? 0), 0) : null;
  const risky_text = risky.length
    ? `${g(risky_grams ?? 0, 2)} g across ${risky.length} hazard-3-or-listed substance${risky.length === 1 ? "" : "s"} (${risky.map((q) => q.species!.name).join(", ")})`
    : "nothing on the bench is on the hazard-5 or danger-critical list or scores 3 or worse";
  const noHood = limitCheck(store, "max_no_hood_gram", ctx.hood ? null : risky_grams, ctx.hood ? "you said there is a hood, so the no-hood cap is not the limit in force" : risky_text);
  if (noHood) {
    limits.push(noHood);
    findings.push(limitFinding(noHood, "this is what a hoodless bench is allowed to have out"));
  }

  const flam = qty.filter((q) => q.species && isFlammable(q.species));
  const flam_missing = flam.some((q) => q.mL === null);
  // the room total counts even when nothing flammable is on the bench: that limit is about the
  // room, and a declared 900 mL of solvent in a cupboard is the same fire load
  const flam_mL = flam.length || ctx.room_flammable_mL > 0 ? flam.reduce((a, q) => a + (q.mL ?? 0), 0) + Math.max(0, ctx.room_flammable_mL) : null;
  const flim = limitCheck(
    store,
    "max_flammable_in_room_mL",
    flam_mL,
    flam.length
      ? `${g(flam_mL ?? 0, 3)} mL between ${flam.map((q) => `${q.species!.name} (${flammableWhy(q.species!)})`).join(", ")}${ctx.room_flammable_mL ? ` plus ${g(ctx.room_flammable_mL, 3)} mL you said is already open in the room` : ""}${flam_missing ? " - and one of these has no volume anywhere on its record, so treat this as a floor" : ""}`
      : "no flammable bottle on the bench" + (ctx.room_flammable_mL ? `, and you said ${g(ctx.room_flammable_mL, 3)} mL is open in the room` : ""),
  );
  if (flim) {
    limits.push(flim);
    findings.push(limitFinding(flim, "vapour heavier than air finds the nearest flame across the floor"));
  }

  const conf: any[] = (store.doc.lab as any)?.stock_bottles ?? [];
  const openAcid = qty.filter((q) => {
    const sp = q.species;
    if (!sp || sp.role !== "acid") return false;
    const b = conf.find((x) => x.species_id === sp.id);
    return !!b && /concentrated/i.test(String(b.label ?? ""));
  });
  const acid_mL = openAcid.length ? openAcid.reduce((a, q) => a + (q.mL ?? 0), 0) : null;
  const alim = limitCheck(
    store,
    "max_open_conc_acid_mL",
    acid_mL,
    acid_mL === null
      ? openAcid.length
        ? `${openAcid.map((q) => q.species!.name).join(", ")} is out and its record gives no density to turn your quantity into a volume`
        : "no concentrated acid out of its bottle"
      : `${openAcid.map((q) => q.species!.name).join(", ")} uncapped: ${g(acid_mL, 2)} mL`,
  );
  if (alim) {
    limits.push(alim);
    findings.push(limitFinding(alim, "fuming acid in the air you are breathing"));
  }

  const water = qty.find((q) => (q.species as SpeciesRec)?.formula === "H2O");
  const both = (acid_mL ?? 0) > 0 && water?.mL != null;
  const ratio = both ? (water!.mL as number) / (acid_mL as number) : null;
  const rlim = limitCheck(
    store,
    "min_water_for_acid_dilution_ratio",
    ratio,
    both
      ? `${g(water!.mL as number, 3)} mL of water for ${g(acid_mL as number, 3)} mL of acid is ${g(ratio!, 2)} volumes each way`
      : "this only bites when a concentrated acid and water are both on the bench",
    "under",
  );
  if (rlim) {
    limits.push(rlim);
    if (both) findings.push(limitFinding(rlim, "add acid to water, and this is thinner than that"));
  }

  for (const l of limits) checks.push(`the ${l.key} limit (${l.limit ?? "no value in the data"}${l.units ? ` ${l.units}` : ""})`);

  /* 5. what applies whatever is on the bench */
  const always: string[] = (provOf(store, "always")?.value as string[]) ?? [];
  const never: string[][] = (provOf(store, "never_mix")?.value as string[][]) ?? [];
  checks.push(`${always.length} standing rules are printed with the verdict, because they apply to an empty bench too`);
  checks.push(`${never.length} never-mix pairs in the limits table, of which ${rules.length} are written out as rules in lab.mixing_rules`);

  const blocked = findings.some((f) => f.level === "block");
  return {
    level: blocked ? "block" : findings.some((f) => f.level === "warn") ? "warn" : "clear",
    blocked,
    findings,
    bottles,
    reaction,
    checks,
    unknown_controls: [...unknown].sort(),
    standing: always,
    limits,
  };
}

/* ------------------------------------------------------------------ matching a rule to a bench

A mixing rule says `bleach` and `acid (any: HCl, vinegar, H2SO4)`. Deciding whether that is on the
bench is the only fuzzy step in this file, so every match carries the reason it was made. */

/** words that describe a state or a quantity rather than a substance. Kept as the whole phrase,
 *  never as a token on its own, or "acid" would match every acid bottle in the warehouse. */
/* class words, which describe a kind of bottle rather than which bottle. "water" and "air" are
   NOT in here: on this shelf water is a record with a formula, and the rule about pouring water
   into acid has to be able to see it. */
const GENERIC = new Set(["acid", "acids", "base", "alkali", "salt", "salts", "metal", "nonmetal", "gas", "liquid", "solid", "solution", "solvent", "oxide", "oxides", "powder", "lump", "chip", "ribbon", "sample", "matter", "surface", "vessel", "bench", "room", "day", "quantity", "heat", "light", "glass", "skin", "flame", "residues", "spill", "spilled"]);
const STOP = new Set(["from", "with", "into", "onto", "onto", "upon", "than", "then", "when", "while", "both", "using", "via", "over", "after", "before", "without", "their", "there", "these", "those", "only", "must", "shall", "should", "have", "been", "being", "which", "that", "this", "your", "yours"]);
const FILLER = /\b(any|anything|the|a|an|in a closed vessel|in an unvented bench|on a hot plate|in excess|stored|plus light|in light|open|by mouth|heat in quantity|confined|or organic matter|you might drink|you might eat|dry|white|soluble|warm|cold|hot|concentrated|dilute|aq|aqueous)\b/gi;

function clean(t: string): string {
  return t.replace(/\([^)]*\)/g, " ").replace(FILLER, " ").replace(/[^A-Za-z0-9 .-]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/** the phrases a rule side can be recognised by, in the order they should be tried: the examples
 *  the rule itself gives ("any: HCl, vinegar, H2SO4"), then its whole phrases, then the
 *  significant words inside them. A bare class word ("acid", "base") is not a token at all -
 *  that is what the role reading below is for, and using the word would let any acid in the
 *  warehouse answer for H2SO4. */
function tokensOf(side: string): string[] {
  const out: string[] = [];
  const paren = side.match(/\(([^)]*)\)/);
  if (paren)
    for (const p of paren[1].split(/[,;]/)) {
      const t = clean(p.replace(/^any:?\s*/i, "").replace(/including.*/i, ""));
      if (t.length > 2 && !GENERIC.has(t)) out.push(t);
    }
  const heads = side
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+(?:or|and)\s+|,\s*|\s+plus\s+/i)
    .map(clean)
    .filter((t) => t.length > 2 && !GENERIC.has(t));
  out.push(...heads);
  for (const h of heads)
    for (const w of h.split(" ").filter((x) => x.length > 3 && !GENERIC.has(x) && !STOP.has(x) && !/^[a-z]?\d+$/.test(x))) out.push(w);
  return [...new Set(out)];
}

function matchSide(side: string, present: SpeciesRec[]): { sp: SpeciesRec; via: string } | null {
  const toks = tokensOf(side).sort((a, b) => b.length - a.length);
  for (const t of toks)
    for (const sp of present) if (mentions(sp, t)) return { sp, via: `its name or formula contains "${t}"` };
  const cls = side.replace(/\([^)]*\)/g, "").trim().toLowerCase();
  for (const sp of present) {
    const lc = sp.name.toLowerCase();
    if (/^acid/.test(cls) && (sp.role === "acid" || /acid/.test(lc))) return { sp, via: `the rule says "acid (any)" and this record's role is acid` };
    if (/^base|^alkali/.test(cls) && sp.role === "base") return { sp, via: `the rule says "${cls}" and this record's role is base` };
    if (/organic solvent/.test(cls) && organic(sp) && isFlammable(sp)) return { sp, via: `the rule says "organic solvent": this is a carbon compound with a flammable label` };
    if (/^ammonia/.test(cls) && /ammonia|ammonium/.test(lc)) return { sp, via: "the name contains ammonia or ammonium" };
    if (/^hypochlorite|^bleach/.test(cls) && /hypochlorit|chlorate\(i\)|bleach/.test(lc)) return { sp, via: "this is the hypochlorite bottle" };
  }
  return null;
}

/** how many of the written rules the app can act on at all: both sides must name something the
 *  shelf has. The rest are about heat, vessels and light, which the app cannot see - they are
 *  still printed, but labelled as things the app cannot enforce. */
export function ruleApplicability(store: Store): { total: number; actionable: number; rows: { with: string; and: string; severity: string; action: string; actionable: boolean; why: string }[] } {
  const rules: any[] = (store.doc.lab as any)?.mixing_rules ?? [];
  const all = store.species;
  const rows = rules.map((r) => {
    const a = matchSide(r.with, all);
    const b = matchSide(r.and, all);
    const actionable = !!a && !!b;
    return {
      with: String(r.with),
      and: String(r.and),
      severity: String(r.severity ?? ""),
      action: String(r.app_action ?? ""),
      actionable,
      why: actionable ? `both sides name something on the shelf: ${a!.sp.name} and ${b!.sp.name}` : "at least one side names a condition, not a substance the shelf holds",
    };
  });
  return { total: rows.length, actionable: rows.filter((r) => r.actionable).length, rows };
}

/* ------------------------------------------------------------------ what to do about it */

/** first aid, chosen for the substance actually in hand. An entry that names the substance wins;
 *  otherwise the hazard class picks, and the record says which of the two happened, because
 *  "inhalation of fumes" is not the same kind of answer as "phenol on the skin". */
export function firstAidFrom(em: Record<string, string>, sp: SpeciesRec): Aid[] {
  const out: Aid[] = [];
  const lc = (sp.name ?? "").toLowerCase();
  const put = (key: string, why: string) => {
    const text = em[key];
    if (typeof text === "string" && text.length && !out.some((o) => o.key === key)) out.push({ key, text, why });
  };
  for (const key of Object.keys(em)) {
    const words = key.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 4 && !["skin", "eyes", "first", "from", "with"].includes(w));
    if (words.some((w) => lc.includes(w))) put(key, "this entry names your substance");
  }
  if (isCorrosive(sp) || sp.role === "acid" || sp.role === "base") {
    put("acid or alkali in the eye", "the label carries the corrosive pictogram or a burn statement");
    put(sp.role === "base" ? "alkali burn" : "acid on the skin", sp.role === "base" ? "the record's role is base" : "the record's role is acid, or the label burns");
  }
  if (isToxic(sp)) put("inhalation of fumes", "the label carries acute toxicity or a serious health hazard");
  if (isFlammable(sp)) put("solvent fire on a person", "the label carries the flammable pictogram");
  if ((sp.hazard_score ?? 0) >= 2) put("ingestion", "the hazard score on the record is 2 or worse");
  if (/mercury/.test(lc)) put("mercury spill", "this is mercury");
  return out;
}

/** which drum it goes in. Only two of the nine classes carry an item list, so the rest are matched
 *  on the element symbols and the words in their own titles - which is what the titles are for. */
export function wasteFor(sp: SpeciesRec, store: Store): Classified[] {
  const wc: Record<string, any> = (store.doc.lab as any)?.waste_classes ?? {};
  const out: Classified[] = [];
  const els = Object.keys(sp.elements ?? {});
  for (const [cls, v] of Object.entries(wc)) {
    const items: string[] = v.items ?? [];
    const inItems = items.find((it: any) => mentions(sp, String(it)) || String(it).toUpperCase() === String(sp.formula ?? "").toUpperCase());
    const titleEls = (String(cls).match(/\(([^)]*)\)/)?.[1] ?? "")
      .split(/[,;]/)
      .map((x) => x.trim())
      .filter((x) => /^[A-Z][a-z]?$/.test(x));
    const byElement = titleEls.length ? els.filter((e) => titleEls.includes(e)) : [];
    const titleWords = String(cls).toLowerCase().replace(/\([^)]*\)/g, " ").split(/[^a-z]+/).filter((w) => w.length > 3);
    const byWord = inItems || byElement.length ? [] : titleWords.filter((w) => mentions(sp, w) || (w === "acid" && sp.role === "acid") || (w === "alkali" && sp.role === "base") || (w === "oxidiser" && isOxidiser(sp)));
    if (inItems) out.push({ cls, rule: String(v.rule ?? ""), why: String(v.why ?? ""), via: `the class lists "${inItems}" as one of its items, and this record matches it` });
    else if (byElement.length) out.push({ cls, rule: String(v.rule ?? ""), why: String(v.why ?? ""), via: `the element ${byElement.join(" or ")} in the class title is in this record` });
    else if (byWord.length) out.push({ cls, rule: String(v.rule ?? ""), why: String(v.why ?? ""), via: `matched on the words in the class title (${byWord.join(", ")})` });
  }
  return out;
}

/** where it lives. The storage rules carry their own reasoning, and two of them list formulas in
 *  that text, which is a better key than anything the app could invent. */
export function storageFor(sp: SpeciesRec, store: Store): Classified[] {
  const rules: any[] = (store.doc.lab as any)?.storage_rules ?? [];
  const out: Classified[] = [];
  for (const r of rules) {
    const text = `${r.rule} ${r.why}`;
    const low = text.toLowerCase();
    const written = (String(r.why).match(/\b[A-Z][A-Za-z]?\d*(?:[A-Z][a-z]?\d*)*\b/g) ?? []).filter((f) => f.length > 2 && /[a-z]/.test(f));
    const named = written.find((f) => String(sp.formula_written ?? sp.formula ?? "").toUpperCase() === f.toUpperCase() || mentions(sp, f));
    let via: string | null = named ? `the rule's own text names ${named}` : null;
    if (!via && /flammab|solvent/.test(low) && isFlammable(sp)) via = "the label carries the flammable pictogram";
    if (!via && /corrosive-acid|acid cabinet/.test(low) && isCorrosive(sp) && sp.role === "acid") via = "the label is corrosive and the record's role is acid";
    if (!via && /oxidiser/.test(low) && isOxidiser(sp)) via = "the record's role or label says oxidiser";
    if (!via && /base cabinet/.test(low) && sp.role === "base") via = "the record's role is base";
    if (!via && /hygroscopic/.test(low) && (sp as any).hygro) via = "the record carries the hygroscopic flag";
    if (!via && /light|amber/.test(low) && (sp as any).light_sensitive) via = "the record says it is light-sensitive";
    if (!via && /cylinder/.test(low) && (sp as any).state === "g") via = "the record's state is gas";
    if (!via && /fridge/.test(low) && isFlammable(sp)) via = "flammable, which is what the fridge rule is about";
    if (via) out.push({ cls: String(r.rule), rule: String(r.rule), why: String(r.why ?? ""), via });
  }
  return out;
}

/** every control token the whole reaction set uses, with counts, so the safety screen can show
 *  what the guard implements and what it does not */
export function controlCensus(store: Store): { token: string; count: number; known: boolean; what: string }[] {
  const m = new Map<string, number>();
  for (const r of store.reactions) for (const c of (r as any).safety?.controls ?? []) m.set(String(c), (m.get(String(c)) ?? 0) + 1);
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([token, count]) => ({ token, count, known: !!controlRule(token), what: controlRule(token)?.what ?? "this app has no rule for this token: it is shown to you as-is" }));
}

/** the five lists the index keeps, as ids, for the screen that shows them in full */
export function safetyLists(store: Store): { key: string; label: string; ids: string[]; what: string }[] {
  const si: any = store.doc.safety_index ?? {};
  const name = (id: string) => store.speciesById.get(id)?.name ?? store.reactionById?.get?.(id)?.name ?? id;
  const row = (key: string, label: string, what: string) => ({
    key,
    label,
    ids: ((si[key] ?? []) as string[]).map(name),
    what,
  });
  return [
    row("reactions_hard_stopped", "hard stops", "refused outright: the record is shown, the reaction is not offered"),
    row("reactions_restricted", "restricted", "a supervisor's call, and the app says whose"),
    row("reactions_needing_hood", "needs a hood", "a fume hood or nothing"),
    row("species_hazard5", "hazard 5", "the top of the hazard scale: refused without a hood, by the index's own rule"),
    row("species_ghs_danger_critical", "GHS danger-critical", "the label says Danger and the hazard is not home-controllable"),
  ];
}
