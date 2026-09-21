/** Where each element sits in the 18-column table, derived from the record - never typed.
 *
 *  The warehouse gives period and group, and leaves `group` null for the f-block members
 *  (which is why this function exists rather than a hard-coded map of 118 cells). La and Ac
 *  are d-block group 3 in this data, so the f rows start at Ce and Th, which is how a lot of
 *  printed tables do it too. */
import type { ElementRec } from "../data/types.js";

export interface Cell {
  row: number;
  col: number;
}
export const GRID = { cols: 18, rows: 10 };

export function cellOf(e: ElementRec): Cell {
  if (e.block === "f") {
    const first = e.period === 6 ? 58 : 90; // Ce, Th
    return { row: e.period === 6 ? 9 : 10, col: 4 + (e.number - first) };
  }
  return { row: e.period ?? 1, col: e.group ?? 1 };
}

/** true when a record is placed somewhere its own fields do not justify - the test uses it,
 *  so a data change that breaks the layout shows up as a failure instead of a blank tile */
export function layoutProblems(els: ElementRec[]): string[] {
  const seen = new Map<string, ElementRec>();
  const bad: string[] = [];
  for (const e of els) {
    const c = cellOf(e);
    if (c.col < 1 || c.col > GRID.cols || c.row < 1 || c.row > GRID.rows)
      bad.push(`${e.symbol}: outside the grid at r${c.row}c${c.col}`);
    if (e.block !== "f" && e.group === null && e.number <= 118)
      bad.push(`${e.symbol}: no group but not f-block`);
    const k = `${c.row}:${c.col}`;
    const other = seen.get(k);
    if (other) bad.push(`${other.symbol}/${e.symbol}: same cell r${c.row}c${c.col}`);
    seen.set(k, e);
  }
  if (seen.size !== els.length) bad.push(`${els.length} elements, ${seen.size} cells`);
  return bad;
}
