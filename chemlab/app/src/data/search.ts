/** Search over the whole warehouse with one normalised token table.
 *
 *  A student types "cuso4", "copper sulphate", "CuSO4.5H2O" or "7758-99-8" and all four must
 *  find the bottle, so the index keys on: the written formula, the Hill formula, the formula
 *  with punctuation removed, every word of the name, the element symbols, and the CAS digits. */

export interface SearchEntry {
  kind: "species" | "element" | "reaction" | "combination";
  id: string;
  label: string;
  sub: string;
  /** lowercase haystack; a rank of 0 means an exact key hit */
  hay: string;
  keys: Set<string>;
}
export interface SearchHit extends SearchEntry {
  score: number;
}

const norm = (s: string): string =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9+.()\[\] -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
/** "CuSO4.5H2O" and "CuSO4 . 5H2O" and "cuso4.5h2o" have to be one key */
const tight = (s: string): string => norm(s).replace(/[^a-z0-9]/g, "");

export function buildSearch(doc: any, combinations: any[]): (q: string, limit?: number) => SearchHit[] {
  const entries: SearchEntry[] = [];
  const add = (kind: SearchEntry["kind"], id: string, label: string, sub: string, keys: string[]) => {
    const set = new Set<string>();
    for (const k of keys) {
      const n = norm(k);
      if (n) set.add(n);
      const t2 = tight(k);
      if (t2.length > 1) set.add(t2);
    }
    entries.push({ kind, id, label, sub, keys: set, hay: norm([label, sub, ...keys].join(" ")) });
  };

  for (const s of doc.species ?? []) {
    const els = Object.keys(s.elements ?? {});
    add(
      "species",
      s.id,
      s.formula_written || s.formula || s.name,
      s.name,
      [
        s.name,
        s.formula_written,
        s.formula,
        s.cas,
        ...(s.name_candidates ?? []),
        ...els,
        ...(s.kind === "aqueous_ion" ? [String(s.id).replace(/^ion:/, "")] : []),
      ].filter(Boolean),
    );
  }
  for (const e of doc.elements ?? []) {
    add("element", e.symbol, `${e.symbol} · ${e.name}`, `Z=${e.number} · ${e.category ?? ""}`, [
      e.name,
      e.symbol,
      String(e.number),
      e.cas,
    ]);
  }
  for (const r of doc.reactions ?? []) {
    add("reaction", r.id, r.name, r.equation || r.record_type, [
      r.name,
      r.equation,
      r.reactants_written,
      r.products_written,
      ...(r.tags ?? []),
      ...(r.categories ?? []),
    ].filter(Boolean));
  }
  for (const c of combinations ?? []) {
    if (!c.formula) continue;
    add("combination", c.pair, c.formula, `${c.pair} · ${c.status}`, [c.formula, c.pair, ...(c.elements ?? [])]);
  }

  return function search(q: string, limit = 40): SearchHit[] {
    const nq = norm(q);
    if (!nq) return [];
    const nqt = tight(q);
    const words = nq.split(" ").filter(Boolean);
    const out: SearchHit[] = [];
    for (const e of entries) {
      let score = 0;
      if (e.keys.has(nq) || (nqt && e.keys.has(nqt))) score = 100;
      else {
        let hit = 0;
        for (const w of words) {
          if (e.hay.includes(w)) hit += 1;
          else if ([...e.keys].some((k) => k.startsWith(w))) hit += 0.75;
        }
        if (hit === 0) continue;
        score = (hit / words.length) * 60;
        if (e.label && norm(e.label).startsWith(nq)) score += 20;
      }
      out.push({ ...e, score });
    }
    // ties go to the element record: someone who types "Fe" is usually standing at the
    // periodic table, and the bottle is one tap away either way
    const rank = { element: 0, species: 1, reaction: 2, combination: 3 } as const;
    out.sort(
      (a, b) =>
        b.score - a.score ||
        rank[a.kind as keyof typeof rank] - rank[b.kind as keyof typeof rank] ||
        a.label.length - b.label.length,
    );
    return out.slice(0, limit);
  };
}
