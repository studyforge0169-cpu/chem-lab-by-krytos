/** Amounts in, moles out. Every conversion says which number it used, because on a bench the
 *  difference between "12.1 M concentrated acid" and "1 M from a bottle" is the whole lesson. */
import type { SpeciesRec } from "../data/types.js";
import type { BenchItem } from "../state/app.js";

export interface Moles {
  moles: number | null;
  grams: number | null;
  /** how it was worked out, in words the UI can print verbatim */
  basis: string;
  warn?: string;
}

export function toMoles(item: BenchItem, s?: SpeciesRec, bottles: any[] = []): Moles {
  const mm = s?.molar_mass?.value ?? null;
  const q = Number(item.qty);
  if (!isFinite(q) || q <= 0) return { moles: null, grams: null, basis: "no amount given" };
  if (item.unit === "mol")
    return {
      moles: q,
      grams: mm ? q * mm : null,
      basis: "entered as moles",
    };
  if (item.unit === "g")
    return mm
      ? { moles: q / mm, grams: q, basis: `${q} g ÷ ${mm} g/mol (the record's molar mass)` }
      : { moles: null, grams: q, basis: "no molar mass on this record, so grams cannot become moles" };
  // a volume: either a solution of known molarity, or a neat liquid with a density
  const L = item.unit === "mL" ? q / 1000 : q;
  if (item.molarity)
    return {
      moles: L * item.molarity,
      grams: mm ? L * item.molarity * mm : null,
      basis: `${L.toFixed(4).replace(/0+$/, "")} L × ${item.molarity} mol/L`,
    };
  const bottle = bottles.find((b) => b.species_id === item.species_id);
  if (bottle?.molarity)
    return {
      moles: L * bottle.molarity,
      grams: mm ? L * bottle.molarity * mm : null,
      basis: `the shelf bottle is ${bottle.molarity} M, so ${q} mL is that many moles`,
      warn: bottle.note ? String(bottle.note) : undefined,
    };
  const den = s?.props_den?.value ?? null;
  if (s?.state === "l" && den)
    return {
      moles: mm ? (L * den * 1000) / mm : null,
      grams: L * den * 1000,
      basis: `${q} mL × ${den} g/cm³ (the record's density) ÷ ${mm} g/mol`,
    };
  return {
    moles: null,
    grams: null,
    basis: "a volume needs a concentration or a density this record does not carry",
    warn: "type the amount in grams or moles instead, or pick a stock bottle",
  };
}
