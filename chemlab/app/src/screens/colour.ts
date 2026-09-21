/** The five colour modes of the table, each a function of the record alone.
 *  A mode must say "no data" instead of quietly colouring a gap with the lowest bucket. */
import type { ElementRec } from "../data/types.js";

export type Mode = "category" | "phase" | "kind" | "en" | "mp";
export const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "category", label: "category", hint: "the block labels the source uses" },
  { id: "phase", label: "phase at 298 K", hint: "solid, liquid or gas in a lab at 25 °C" },
  { id: "kind", label: "metal / non-metal", hint: "one rule, three answers" },
  { id: "en", label: "electronegativity", hint: "Pauling, no value where the scale stops" },
  { id: "mp", label: "melting point", hint: "°C, log-free; sublimers are marked" },
];

const CAT: Record<string, string> = {
  "Alkali metals": "var(--cat-alkali)",
  "Alkaline earth metals": "var(--cat-alkaline)",
  "Transition metals": "var(--cat-transition)",
  "Poor metals": "var(--cat-post)",
  "Post-transition metals": "var(--cat-post)",
  Metalloids: "var(--cat-metalloid)",
  Nonmetals: "var(--cat-nonmetal)",
  Halogens: "var(--cat-halogen)",
  "Noble gases": "var(--cat-noble)",
  Lanthanides: "var(--cat-lanth)",
  Actinides: "var(--cat-actin)",
};
const PHASE: Record<string, string> = {
  Solid: "#5c7ba3",
  Liquid: "#3fa9d8",
  Gas: "#e0c46a",
};

const mix = (a: [number, number, number], b: [number, number, number], t: number): string => {
  const c = a.map((x, i) => Math.round(x + (b[i]! - x) * Math.min(1, Math.max(0, t))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
};
const COOL: [number, number, number] = [38, 84, 130];
const WARM: [number, number, number] = [214, 108, 74];
const COLD: [number, number, number] = [70, 150, 200];
const HOT: [number, number, number] = [236, 176, 84];

export interface TileColour {
  bg: string;
  /** the label the legend must show for this tile */
  legend: string;
  nodata: boolean;
}

export function tileColour(e: ElementRec, mode: Mode): TileColour {
  if (mode === "category") {
    const c = e.category ?? "";
    return { bg: CAT[c] ?? "var(--cat-unknown)", legend: c || "unclassified", nodata: !c };
  }
  if (mode === "phase") {
    const p = e.phase_at_298K ?? "";
    return { bg: PHASE[p] ?? "var(--cat-unknown)", legend: p || "not stated", nodata: !p };
  }
  if (mode === "kind") {
    const c = (e.category ?? "").toLowerCase();
    const metal = /metal|lanthan|actin/.test(c) && !metalloid(c);
    const kind = metal ? "metal" : c.includes("nonmetal") || c.includes("halogen") || c.includes("noble") ? "non-metal" : "metalloid";
    return {
      bg: kind === "metal" ? "#4f7fb8" : kind === "non-metal" ? "#c7cf6a" : "#5fb3ab",
      legend: kind,
      nodata: !e.category,
    };
  }
  if (mode === "en") {
    const v = e.electronegativity_pauling?.value ?? null;
    if (v === null) return { bg: "var(--cat-unknown)", legend: "no value", nodata: true };
    return { bg: mix(COOL, WARM, (v - 0.6) / (4.0 - 0.6)), legend: `χ ${v}`, nodata: false };
  }
  const v = e.mel_point?.value ?? null;
  if (v === null) return { bg: "var(--cat-unknown)", legend: "not measured", nodata: true };
  return { bg: mix(COLD, HOT, (v + 280) / (3500 + 280)), legend: `${v} °C`, nodata: false };
}
const metalloid = (c: string) => c.includes("metalloid");

/** the legend entries for a mode, with how many elements fall in each - so a gap in the data
 *  is visible as a count, not hidden */
export function legendFor(els: ElementRec[], mode: Mode): { label: string; n: number; bg: string }[] {
  const m = new Map<string, { n: number; bg: string }>();
  for (const e of els) {
    const t = tileColour(e, mode);
    const k = t.legend;
    m.set(k, { n: (m.get(k)?.n ?? 0) + 1, bg: t.bg });
  }
  const rows = [...m.entries()].map(([label, v]) => ({ label, n: v.n, bg: v.bg }));
  if (mode === "en" || mode === "mp")
    return rows.sort((a, b) => parseFloat(a.label.replace(/[^0-9.\-]/g, "")) - parseFloat(b.label.replace(/[^0-9.\-]/g, "")));
  return rows.sort((a, b) => b.n - a.n);
}
