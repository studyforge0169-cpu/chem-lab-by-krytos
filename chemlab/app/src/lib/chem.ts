/** A formula reader, so the app can derive rather than look up: how many hydroxides in
 *  Ca(OH)2, how many carbonates in Na2CO3, and whether the record's molar mass is what the
 *  formula actually says. Formulas arrive in Hill order ("C2H4O2", "ClNa") with hydrate dots
 *  and parentheses; charge is carried separately on the record, not in the string. */

export type Counts = Record<string, number>;

/** count the atoms of each element in one formula unit; null when the string is not a formula */
export function parseFormula(input: string): Counts | null {
  const s = String(input ?? "").trim();
  if (!s || !/[A-Za-z]/.test(s)) return null;
  if (/[^A-Za-z0-9.()·\[\]\s-]/.test(s)) return null; // charges, arrows, Greek letters: not a formula
  const out: Counts = {};
  const add = (src: Counts, k: number) => {
    for (const [el, n] of Object.entries(src)) out[el] = (out[el] ?? 0) + n * k;
  };
  // a leading number in front of a part ("5H2O") is handled by the split above only when the
  // dot is present; for the dot form we must read the multiplier off the raw string instead
  const raw = s.replace(/\s+/g, "");
  const chunks = raw.split(/(?=[A-Z][a-z]?\()|\.(?=\d)|·(?=\d)/).filter(Boolean);
  const pieces = chunks.length > 1 ? chunks : [raw];
  for (const piece of pieces) {
    const m = piece.match(/^(\d*)(.+)$/);
    const mult = m && m[1] ? Number(m[1]) : 1;
    const body = m ? m[2] : piece;
    const inner = countBlock(body);
    if (inner === null) return null;
    add(inner, mult);
  }
  return Object.keys(out).length ? out : null;
}

function countBlock(body: string): Counts | null {
  const out: Counts = {};
  const re = /(\[([^\]]+)\]|[A-Z][a-z]?|\(([^)]*)\))(\d*)/g;
  let i = 0;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(body)) && guard++ < 200) {
    if (m.index !== i) return null; // unmatched junk between tokens
    i = re.lastIndex;
    const group = m[2] ?? m[3];
    const n = m[4] === "" ? 1 : Number(m[4]);
    if (group !== undefined) {
      if (m[1].startsWith("[")) {
        // a bracketed ion group carries its own charge suffix, e.g. [Fe(CN)6] - read it as atoms
        const sub = countBlock(group.replace(/\d+$/, ""));
        if (sub === null) return null;
        for (const [el, k] of Object.entries(sub)) out[el] = (out[el] ?? 0) + k * n;
      } else {
        const sub = countBlock(group);
        if (sub === null) return null;
        for (const [el, k] of Object.entries(sub)) out[el] = (out[el] ?? 0) + k * n;
      }
    } else {
      const el = m[1];
      if (!/^[A-Z][a-z]?$/.test(el)) return null;
      out[el] = (out[el] ?? 0) + n;
    }
  }
  if (i !== body.length) return null;
  return out;
}

/** how many of a given element (or OH-style group) one formula unit carries */
export function groupCount(formula: string, group: string): number | null {
  const body = String(formula ?? "").replace(/\s+/g, "");
  if (!body || !group) return null; // an empty group would match everywhere, which is not an answer
  const asGroup = new RegExp(`\\(?${group.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)?(\\d*)`, "g");
  let total = 0;
  let m: RegExpExecArray | null;
  while ((m = asGroup.exec(body))) {
    if (m[0] === "") asGroup.lastIndex++; // never spin on a zero-width match
    total += m[1] ? Number(m[1]) : 1;
  }
  return total || null;
}

/** M from the parsed formula and the atomic weights the element records carry - the app's own
 *  copy of what the build did, so a shipped molar mass can be checked, not trusted */
export function molarMassFromFormula(formula: string, weightOf: (el: string) => number | null): number | null {
  const counts = parseFormula(formula);
  if (!counts) return null;
  let sum = 0;
  for (const [el, n] of Object.entries(counts)) {
    const w = weightOf(el);
    if (w === null) return null;
    sum += w * n;
  }
  return Math.round(sum * 1000) / 1000;
}

export const hillFormula = (counts: Counts): string => {
  const keys = Object.keys(counts);
  const hill = (a: string, b: string): number => {
    const carbon = a === "C", carbonB = b === "C";
    if (carbon !== carbonB) return carbon ? -1 : 1;
    const hydrogen = a === "H", hydrogenB = b === "H";
    if (hydrogen !== hydrogenB) return hydrogen ? -1 : 1;
    return a.localeCompare(b);
  };
  return keys
    .sort(hill)
    .map((k) => `${k}${counts[k] === 1 ? "" : counts[k]}`)
    .join("");
};
