/** The shelf's query, as a pure function, so it can be tested without a DOM. */
import type { SpeciesRec, Store } from "../data/types.js";

export interface ShelfQuery {
  q: string;
  kind: "all" | "species" | "aqueous_ion" | "mixture" | "element" | "other";
  state: "any" | "s" | "l" | "g" | "aq";
  hazard: "any" | 1 | 2 | 3 | 4 | 5;
  weighable: boolean;
  sort: "name" | "hazard" | "mass";
}
export const DEFAULT_QUERY: ShelfQuery = {
  q: "",
  kind: "all",
  state: "any",
  hazard: "any",
  weighable: false,
  sort: "name",
};

const ELEMENT_ID = /^elem_/;
export function weighable(s: SpeciesRec): boolean {
  // no formula to put on a balance, no stoichiometry: the data says so by the kind it has
  // (an aqueous ion is bookkeeping for a net-ionic equation, not a bottle either)
  if (s.kind !== "species") return false;
  if (!s.formula) return false;
  return (s.molar_mass?.value ?? null) !== null;
}

export function filterShelf(store: Store, query: ShelfQuery, limit = 200): SpeciesRec[] {
  const q = query.q.trim();
  const ids = q.length > 1 ? new Set(store.search(q, 400).map((h: any) => h.id)) : null;
  let rows = store.species.filter((s) => {
    if (ids && !ids.has(s.id)) return false;
    switch (query.kind) {
      case "species":
        if (s.kind !== "species" || ELEMENT_ID.test(s.id)) return false;
        break;
      case "element":
        if (!s.from_element && !ELEMENT_ID.test(s.id)) return false;
        break;
      case "aqueous_ion":
        if (s.kind !== "aqueous_ion") return false;
        break;
      case "mixture":
        if (s.kind !== "mixture" && s.kind !== "polymer") return false;
        break;
      case "other":
        if (["species", "aqueous_ion", "mixture", "polymer"].includes(s.kind)) return false;
        break;
      default:
        break;
    }
    if (query.state !== "any" && s.state !== query.state) return false;
    if (query.hazard !== "any" && (s.hazard_score ?? 0) < query.hazard) return false;
    if (query.weighable && !weighable(s)) return false;
    return true;
  });
  const byName = (a: SpeciesRec, b: SpeciesRec) =>
    (a.formula_written ?? a.name).localeCompare(b.formula_written ?? b.name);
  if (query.sort === "hazard")
    rows = rows.sort((a, b) => (b.hazard_score ?? 0) - (a.hazard_score ?? 0) || byName(a, b));
  else if (query.sort === "mass")
    rows = rows.sort(
      (a, b) => (b.molar_mass?.value ?? 0) - (a.molar_mass?.value ?? 0) || byName(a, b),
    );
  else rows = rows.sort(byName);
  return rows.slice(0, limit);
}
