/** How much: the recipe, who runs out first, and how precisely the measurements behind
 *  it were made. Pure, so the numbers can be tested without a screen. */
import type { ReactionRec, Store } from "../data/types.js";
import { g } from "./format.js";
import type { Moles } from "./amounts.js";
import type { BenchItem } from "../state/app.js";
import type { SpeciesRec } from "../data/types.js";

export interface PlanRow {
  side: "reactant" | "product";
  species_id: string | null;
  label: string;
  coefficient: number;
  molar_mass: number | null;
  have_mol: number | null;
  /** how much this term needs for the extent the mixture can support */
  need_mol: number | null;
  left_mol: number | null;
  grams_have: number | null;
  limiting?: boolean;
  grams_yield: number | null;
}
export interface Plan {
  rows: PlanRow[];
  extent_mol: number | null;
  limiting: string[];
  per: string;
  actual_yield_g?: number;
  percent?: number | null;
  notes: string[];
}

/** extent of reaction, in "moles of the equation as written": the number every other
 *  quantity on this screen is multiplied by */
export type PlanItem = { item: BenchItem; species?: SpeciesRec; moles?: Moles };
export function reactionPlan(reaction: ReactionRec, items: PlanItem[], actualYield_g?: number): Plan {
  const notes: string[] = [];
  const byId = new Map(items.filter((i) => i.species?.id).map((i) => [i.species!.id, i]));
  const terms = [
    ...(reaction.reactants ?? []).map((t) => ({ t, side: "reactant" as const })),
    ...(reaction.products ?? []).map((t) => ({ t, side: "product" as const })),
  ];
  let extent: number | null = null;
  let unknown_reactants: string[] = [];
  const reactExtents: { id: string; e: number }[] = [];
  for (const { t, side } of terms) {
    if (side !== "reactant") continue;
    const have = (t.species_id ? byId.get(t.species_id)?.moles?.moles : null) ?? null;
    if (have === null) {
      unknown_reactants.push(t.display_name ?? t.token);
      continue;
    }
    const e = have / (t.coefficient || 1);
    reactExtents.push({ id: t.species_id ?? t.token, e });
    extent = extent === null ? e : Math.min(extent, e);
  }
  if (unknown_reactants.length) {
    extent = null;
    reactExtents.length = 0;
  }
  if (unknown_reactants.length)
    notes.push(
      `no amount could be turned into moles for ${unknown_reactants.join(", ")} — and an amount you do not know is exactly the one that would run out first, so this whole panel stays unquantitative rather than assuming it is in excess`,
    );
  // a limiting reagent only exists if every reactant has a measured amount
  if (unknown_reactants.length) {
    extent = null;
    reactExtents.length = 0;
  }
  if (reactExtents.length && items.length > reactExtents.length)
    notes.push(
      `${items.length - reactExtents.length} of the things on your bench are not in this equation — treated as spectators, which is what the record says, not what reality promises`,
    );
  const limiting =
    extent === null
      ? []
      : reactExtents.filter((x) => Math.abs(x.e - extent) < 1e-9).map((x) => x.id);

  const rows: PlanRow[] = terms.map(({ t, side }) => {
    const sp = side === "reactant" ? byId.get(t.species_id ?? "")?.species : undefined;
    const mm = t.molar_mass ?? sp?.molar_mass?.value ?? null;
    const need = extent === null ? null : extent * (t.coefficient || 1);
    const have = side === "reactant" ? (t.species_id ? byId.get(t.species_id)?.moles?.moles ?? null : null) : null;
    return {
      side,
      species_id: t.species_id ?? null,
      label: t.display_name ?? t.token,
      coefficient: t.coefficient ?? 1,
      molar_mass: mm,
      have_mol: have,
      need_mol: need,
      left_mol: have !== null && need !== null ? have - need : null,
      grams_have: have !== null && mm ? have * mm : null,
      grams_yield: need !== null && mm ? need * mm : null,
      limiting: side === "reactant" && t.species_id !== null && limiting.includes(t.species_id),
    };
  });
  const theoretical = rows
    .filter((r) => r.side === "product")
    .reduce((a, r) => a + (r.grams_yield ?? 0), 0);
  return {
    rows,
    extent_mol: extent,
    limiting,
    per: reaction.thermo_derived?.per ?? "one mole of the equation as written",
    actual_yield_g: actualYield_g,
    percent:
      actualYield_g !== undefined && theoretical > 0
        ? Math.min(999, (actualYield_g / theoretical) * 100)
        : null,
    notes,
  };
}

/** the piece of glassware a measurement should have been made with: the smallest one that
 *  holds it, preferring an instrument that measures rather than holds */
export interface GlassPick {
  id: string;
  name: string;
  capacity_mL: number | null;
  tolerance_mL: number | null;
  relative_percent: number | null;
  note?: string;
}
const MEASURE = new Set(["deliver", "measure", "make-up", "micro"]);

export function pickGlassware(store: Store, volume_mL: number, want: "measure" | "hold" = "measure"): GlassPick {
  const list = (store.doc.tables?.glassware ?? []) as any[];
  const sized = list.filter((x) => x?.capacity_mL?.value);
  const smallest = sized.length ? Math.min(...sized.map((x) => x.capacity_mL.value)) : null;
  const largest = sized.length ? Math.max(...sized.map((x) => x.capacity_mL.value)) : null;
  const usable = sized
    .filter((x) => x.capacity_mL.value >= volume_mL)
    .filter((x) => (want === "measure" ? MEASURE.has(x.kind) : true));
  if (!usable.length)
    return {
      id: "none",
      name: "nothing in the data fits",
      capacity_mL: null,
      tolerance_mL: null,
      relative_percent: null,
      note:
        largest !== null && volume_mL > largest
          ? `larger than the biggest piece the data lists (${g(largest, 3)} mL) — this is made up in several portions, or in a volumetric flask you do not have`
          : smallest !== null
            ? `below the smallest thing the data lists (${g(smallest, 4)} mL): at that size the meniscus, not the calibration, is your error — weigh it instead`
            : "the data lists no glassware",
    };
  usable.sort((a, b) => a.capacity_mL.value - b.capacity_mL.value);
  const best = usable[0];
  const tol = best.tolerance_mL?.value ?? null;
  const relative_percent = tol
    ? (tol / Math.max(volume_mL, 1e-9)) * 100
    : (best.relative_uncertainty_percent ?? null);
  const misuse =
    relative_percent !== null && relative_percent > 5
      ? `used far from its calibration point: ${g(relative_percent, 2)} % of the volume you are measuring out of it — that is a rough number, not a titration reading`
      : null;
  return {
    id: best.id,
    name: best.name,
    capacity_mL: best.capacity_mL.value,
    tolerance_mL: tol,
    relative_percent,
    note: [best.note, misuse].filter(Boolean).join(" — ") || undefined,
  };
}

/** what the balance itself contributes: the row is in the same table as the glassware, with
 *  graduation_mL carrying the readability in grams. A 0.2 g sample on a 0.01 g top-pan balance
 *  is a 10 % measurement, and the app has to say that rather than print six digits. */
export interface BalancePick {
  id: string;
  name: string;
  readability_g: number | null;
  uncertainty_g: number;
  relative_percent: number | null;
  digits: number | null;
  note?: string;
}

export function pickBalance(store: Store, mass_g: number): BalancePick {
  const rows = ((store.doc.tables?.glassware ?? []) as any[]).filter((x) => x?.kind === "weigh");
  const fit = rows
    .filter((x) => (x.capacity_mL?.value ?? Infinity) >= Math.abs(mass_g))
    .sort((a, b) => (a.graduation_mL ?? 1) - (b.graduation_mL ?? 1));
  const overloaded = !fit.length && rows.length > 0;
  const best = fit[0] ?? rows[0] ?? null;
  const readability = best?.graduation_mL ?? null;
  if (!best || readability === null)
    return {
      id: "none",
      name: "no balance in the data",
      readability_g: null,
      uncertainty_g: 0,
      relative_percent: null,
      digits: null,
      note: "the glassware table carries no weighing instrument, so no error can be attached to a mass",
    };
  // one reading is ± the last digit, but you weigh a boat and then a boat-plus-sample: two readings
  const unc = 2 * readability;
  const rel = Math.abs(mass_g) > 1e-9 ? (unc / Math.abs(mass_g)) * 100 : null;
  return {
    id: best.id,
    name: best.name,
    readability_g: readability,
    uncertainty_g: unc,
    relative_percent: rel,
    digits: rel === null ? null : Math.max(1, Math.min(6, Math.floor(-Math.log10(rel / 100)) + 1)),
    note:
      (overloaded
        ? `more than the ${g(best.capacity_mL?.value ?? 0, 3)} g this balance goes up to — it will not report a mass, it will complain`
        : best.note ?? "") || undefined,
  };
}

/** make up V mL of M mol/L from a dry solid: moles, grams, the flask and the balance error */
export function solutionFromSolid(
  store: Store,
  species: SpeciesRec | undefined,
  volume_mL: number,
  molarity: number,
): {
  moles: number;
  grams: number | null;
  molar_mass: number | null;
  flask: GlassPick;
  balance: BalancePick;
  error: { rss: number | null; worst: number | null; sum: number | null; flag: string | null };
  honest: string | null;
} | null {
  const mm = species?.molar_mass?.value ?? null;
  if (!mm) return null;
  const moles = (volume_mL / 1000) * molarity;
  const grams = moles * mm;
  const flask = pickGlassware(store, volume_mL); // make-up glassware is in the measuring set, so a volumetric flask wins over a beaker
  const balance = pickBalance(store, grams);
  const error = combineRelative([flask.relative_percent, balance.relative_percent]);
  return {
    moles,
    grams,
    molar_mass: mm,
    flask,
    balance,
    error,
    honest:
      flask.relative_percent !== null && balance.relative_percent !== null
        ? balance.relative_percent > flask.relative_percent
          ? `the balance, not the flask, is the weak link here: ${g(balance.relative_percent, 2)} % against ${g(flask.relative_percent, 3)} %`
          : `the flask dominates: ${g(flask.relative_percent, 3)} %`
        : null,
  };
}

/** independent errors add in quadrature, which is what a practical-mark scheme assumes */
export function combineRelative(percents: (number | null)[]): {
  rss: number | null;
  worst: number | null;
  sum: number | null;
  flag: string | null;
} {
  const xs = percents.filter((x): x is number => typeof x === "number" && isFinite(x) && x >= 0);
  if (!xs.length) return { rss: null, worst: null, sum: null, flag: null };
  const worst = Math.max(...xs);
  const best = Math.min(...xs);
  const flag =
    xs.length > 1 && worst > 10 * Math.max(best, 1e-9)
      ? `one term owns this error (${g(worst, 2)} % against ${g(best, 2)} %): fix that measurement before you fix the arithmetic`
      : null;
  return {
    rss: Math.sqrt(xs.reduce((a, b) => a + b * b, 0)),
    worst,
    sum: xs.reduce((a, b) => a + b, 0),
    flag,
  };
}

/** how many digits the answer is entitled to: an error of 2 % kills the third figure */
export function sigFigs(value: number, relPercent: number | null): string {
  if (!isFinite(value)) return "—";
  const digits = relPercent === null ? 4 : Math.max(1, Math.min(6, Math.floor(-Math.log10(relPercent / 100)) + 1));
  return String(Number(value.toPrecision(digits)));
}
