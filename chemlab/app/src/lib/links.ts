/** Deep links: one format, used by the manifest's home-screen shortcuts, by "copy a link to this
 *  bench" and by anything the app ever wants to share. Parsed defensively, because a hand-typed
 *  URL is a person, not a compiler. */
import type { BenchItem, Sheet, Tab } from "../state/app.js";

export const TABS: Tab[] = ["table", "shelf", "bench", "ai", "calc", "safety", "reactions", "work", "more"];
const UNITS: BenchItem["unit"][] = ["g", "mol", "mL", "L"];

export interface Link {
  tab: Tab | null;
  bench: BenchItem[];
  sheet: Sheet;
  /** what the parser could not use, in words a screen can print */
  problems: string[];
}

export const EMPTY_LINK: Link = { tab: null, bench: [], sheet: null, problems: [] };

function params(search: string): Map<string, string> {
  const out = new Map<string, string>();
  const q = search.replace(/^[?#]/, "");
  if (!q) return out;
  for (const part of q.split("&")) {
    if (!part) continue;
    const i = part.indexOf("=");
    const k = decode(i < 0 ? part : part.slice(0, i));
    const v = i < 0 ? "" : decode(part.slice(i + 1));
    if (!out.has(k)) out.set(k, v);
  }
  return out;
}
const decode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
};

/** `nacl:20g`, `hcl:5mL@2`, `water:0.25L` — amount glued to its unit, molarity after an @ */
export function parseBenchItem(text: string): { item?: BenchItem; problem?: string } {
  const m = /^([A-Za-z0-9_.\-]+):(\d+(?:\.\d+)?)(g|mol|mL|L)(?:@(\d+(?:\.\d+)?))?$/.exec(text.trim());
  if (!m) return { problem: `“${text}” is not substance:amount+unit (try nacl:20g or hcl:5mL@2)` };
  const [, species_id, qty, unit, molarity] = m;
  if (!UNITS.includes(unit as BenchItem["unit"])) return { problem: `“${text}” uses a unit the bench has no use for` };
  const item: BenchItem = { species_id, qty: Number(qty), unit: unit as BenchItem["unit"] };
  if (molarity) item.molarity = Number(molarity);
  return { item };
}

export function parseLink(search: string): Link {
  const p = params(search);
  if (!p.size) return EMPTY_LINK;
  const problems: string[] = [];
  const out: Link = { tab: null, bench: [], sheet: null, problems };

  const tab = p.get("tab");
  if (tab) {
    if ((TABS as string[]).includes(tab)) out.tab = tab as Tab;
    else problems.push(`“${tab}” is not one of the ${TABS.length} tabs (${TABS.join(", ")})`);
  }

  const bench = p.get("bench");
  if (bench)
    for (const bit of bench.split(",")) {
      if (out.bench.length >= 4) {
        problems.push("the bench holds four bottles; the rest of that link was not read");
        break;
      }
      const { item, problem } = parseBenchItem(bit);
      if (item) out.bench.push(item);
      else if (problem) problems.push(problem);
    }

  const sheetFor: [string, string][] = [["species", "species"], ["element", "element"], ["reaction", "reaction"], ["pair", "combination"]];
  for (const [key, kind] of sheetFor) {
    const v = p.get(key);
    if (!v) continue;
    if (out.sheet) {
      problems.push(`“${key}” was ignored: a link opens one sheet, and a ${(out.sheet as any).kind} sheet was already named`);
      continue;
    }
    out.sheet = (kind === "species" || kind === "reaction" ? { kind, id: v } : kind === "element" ? { kind, symbol: v } : { kind, pair: v }) as Sheet;
  }

  // a link that mixes something is a link about the bench, so the tab follows the bottles
  if (out.tab === null && out.bench.length) out.tab = "bench";
  return out;
}

export function buildLink(l: { tab?: Tab | null; bench?: BenchItem[]; sheet?: Sheet; species_id?: string }): string {
  const p = new URLSearchParams();
  if (l.tab) p.set("tab", l.tab);
  if (l.bench?.length)
    p.set(
      "bench",
      l.bench
        .map((b) => `${b.species_id}:${b.qty}${b.unit}${b.molarity !== undefined && b.molarity !== null ? `@${b.molarity}` : ""}`)
        .join(","),
    );
  const s = l.sheet;
  if (s && typeof s === "object" && "kind" in s) {
    const any = s as any;
    if (any.kind === "species") p.set("species", any.id);
    else if (any.kind === "reaction") p.set("reaction", any.id);
    else if (any.kind === "element") p.set("element", any.symbol);
    else if (any.kind === "combination") p.set("pair", any.pair);
  }
  const q = p.toString();
  return q ? `?${q}` : "";
}

/** does a link's bench refer to anything the shelf has? A link is allowed to name a substance the
 *  build does not carry, and the screen has to say which one is missing rather than dropping it. */
export function unresolvedBench(bench: BenchItem[], has: (id: string) => boolean): string[] {
  return bench.filter((b) => !has(b.species_id)).map((b) => b.species_id);
}
