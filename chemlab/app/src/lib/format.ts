/** Number and provenance formatting. The rule this file exists for: a value and its
 *  provenance are rendered together or not at all, so the component that shows one shows the
 *  other, and no screen can quietly drop the "approx". */
import type { Prov } from "../data/types.js";

/** %.4g, but 58.44 stays 58.44 and 100 does not become 1e+2 in the UI */
export function g(v: number | null | undefined, sig = 4): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  if (Number.isInteger(v) && Math.abs(v) < 1e6) return String(v);
  const s = v.toPrecision(sig);
  return String(Number(s));
}

export function sci(v: number | null | undefined, sig = 3): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) {
    const e = Math.floor(Math.log10(a));
    return `${(v / 10 ** e).toPrecision(sig)}×10${sup(String(e))}`;
  }
  return String(Number(v.toPrecision(sig)));
}
const SUP: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
export function sup(s: string): string {
  return [...s].map((c) => SUP[c] ?? c).join("");
}

export const CONF_LABEL: Record<string, string> = {
  high: "as published",
  med: "medium confidence",
  low: "low confidence",
  approx: "approximate",
};

export interface ProvView {
  text: string;
  unit: string;
  conf: string | null;
  approx: boolean;
  predicted: boolean;
  missing: string | null;
  note: string | null;
  source: string | null;
  kelvin: number | null;
}

/** One function so every field on screen agrees about what "no value" looks like. */
export function view(p?: Prov<any> | null): ProvView | null {
  if (!p || typeof p !== "object") return null;
  const approx = p.confidence === "approx";
  const predicted = p.measured === false;
  /* a number the build re-derived (a molar mass out of atomic weights, a ΔH re-added from the
     ledger) is confident but it is not somebody's published measurement, and the label must not
     imply that it is */
  const selfComputed =
    /^(computed|derived)/i.test(String((p as any).basis ?? "")) ||
    (!!(p as any).basis === false && /^(computed|derived)\b/i.test(String(p.source ?? "")));
  const missing = p.value === null || p.value === undefined ? (p.missing ?? p.note ?? "no value in the data") : null;
  return {
    text: p.value === null || p.value === undefined ? "—" : g(Number(p.value)),
    unit: p.units ?? "",
    conf: selfComputed ? "computed here" : (CONF_LABEL[p.confidence ?? ""] ?? null),
    approx,
    predicted,
    missing,
    note: p.note ?? null,
    source: p.source ?? null,
    kelvin: typeof p.kelvin === "number" ? p.kelvin : null,
  };
}

const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "-": "₋" };
export function subs(s: string): string {
  return [...s].map((c) => SUB[c] ?? c).join("");
}

/** Counts are subscripts; charges are superscripts. Getting this wrong is the classic
 *  formula-rendering bug: NaNO₃ must never come out as NaNO³. */
export function formula(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/([A-Za-z)\]])(\d+)/g, (_m, a, b) => a + subs(b));
}

/** An ion written the way the electrode table writes it: "Cu^2+", "MnO4^-", "H^+", "Cl2".
 *  Counts go below, the charge above. `formula` alone would turn Cu^2+ into Cu²₂⁺, and the
 *  caret is what tells the two apart, so the data keeps it and this is the only place it is read. */
export function ionLabel(s: string | null | undefined): string {
  if (!s) return "";
  const m = s.match(/\^(\d*)([+-])$/);
  if (m) {
    const body = s.slice(0, m.index);
    const mag = m[1] && m[1] !== "1" ? sup(m[1]) : "";
    return `${formula(body)}${mag}${m[2] === "-" ? "⁻" : "⁺"}`;
  }
  // no caret: the digits before the sign are a charge only when what precedes them is a single
  // element symbol ("Cu2+", "H+"), otherwise they are a count and the charge is one ("MnO4-")
  const plain = s.match(/(\d*)([+-])$/);
  if (plain) {
    const body = s.slice(0, plain.index);
    const digits = plain[1] ?? "";
    const charge = /^[A-Z][a-z]?$/.test(body) ? digits : "";
    const count = charge ? "" : digits;
    return `${formula(body + count)}${charge && charge !== "1" ? sup(charge) : ""}${plain[2] === "-" ? "⁻" : "⁺"}`;
  }
  return formula(s);
}

/** an equation string, with subscripts on the counts and nothing else touched. The warehouse
 *  writes "=" on purpose (some of these are equilibria), so the app does not turn it into "→" */
export const eq = (t: string | null | undefined): string => formula(t);

/** +2 / −2 / 0, with the minus that matches the rest of the UI */
export function oxText(x: number): string {
  if (x === 0) return "0";
  return x > 0 ? `+${x}` : `−${Math.abs(x)}`;
}
export function oxList(xs?: number[] | null): string {
  return (xs ?? []).map(oxText).join(" ");
}

/** an ion's symbol with its charge as a superscript: Fe³⁺, SO₄²⁻ */
export function ionSymbol(sym: string, charge: number): string {
  const mag = Math.abs(charge) === 1 ? "" : String(Math.abs(charge));
  const sign = charge > 0 ? "+" : "−";
  return `${formula(sym)}${sup(mag + sign)}`;
}

export function chargeText(charge?: number | null): string {
  if (charge === null || charge === undefined || charge === 0) return "";
  const m = Math.abs(charge) === 1 ? "" : String(Math.abs(charge));
  return m + (charge > 0 ? "+" : "−");
}

export function joinList(xs: (string | null | undefined)[]): string {
  return xs.filter(Boolean).join(" · ");
}

export function stateWord(state?: string | null): string {
  return (
    { s: "solid", l: "liquid", g: "gas", aq: "in solution", v: "vapour", soln: "solution" }[
      state ?? ""
    ] ?? state ?? ""
  );
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return `${v.toFixed(digits)} %`;
}
