import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Loaded } from "../data/load.js";
import type { Store } from "../data/types.js";
import { DEFAULT_CTX, type GuardCtx } from "../lib/guard.js";
import { decodeNotes, type Note } from "../lib/notebook.js";

/** where the work is being done. The guard reads this, so it lives beside the bench rather than
 *  inside one screen - and it stays on the device, because "I have a hood" is not news every day. */
const CTX_KEY = "chemlab.guard_ctx.v1";
const NOTES_KEY = "chemlab.notebook.v1";

/* the notebook is read back through the same decoder as an imported file, so a hand-edited or
   half-written localStorage entry cannot crash the app on the way in */
function readNotes(): Note[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(NOTES_KEY) : null;
    if (!raw) return [];
    return decodeNotes(raw).notes;
  } catch {
    return [];
  }
}
function readCtx(): GuardCtx {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(CTX_KEY) : null;
    if (!raw) return { ...DEFAULT_CTX };
    const p = JSON.parse(raw);
    return {
      hood: !!p.hood,
      supervised: !!p.supervised,
      room_flammable_mL: Number.isFinite(Number(p.room_flammable_mL)) ? Math.max(0, Number(p.room_flammable_mL)) : 0,
    };
  } catch {
    return { ...DEFAULT_CTX };
  }
}

export type Tab = "table" | "shelf" | "bench" | "ai" | "calc" | "safety" | "reactions" | "work" | "more";

/** One line on the bench: a substance plus the amount the user actually measured out. */
export interface BenchItem {
  species_id: string;
  qty: number;
  unit: "g" | "mol" | "mL" | "L";
  /** for mL/L, the concentration of the solution being poured */
  molarity?: number;
}

/** which calculator the Calc tab is showing, and which two electrodes the cell builder has picked.
 *  Both live here rather than in the screens because the pair browser and the safety guard both
 *  hand a pair to the cell builder. */
export type CalcMode = "solution" | "buffer" | "titration" | "cell" | "series";
export type CellPair = { a: string; b: string };

export type Sheet =
  | { kind: "element"; symbol: string }
  | { kind: "species"; id: string }
  | { kind: "reaction"; id: string }
  | { kind: "combination"; pair: string }
  | { kind: "precip"; key: string }
  | null;

interface Ctx extends Loaded {
  store: Store;
  tab: Tab;
  setTab: (t: Tab) => void;
  bench: BenchItem[];
  setBench: (b: BenchItem[]) => void;
  addToBench: (id: string) => void;
  sheet: Sheet;
  open: (s: NonNullable<Sheet>) => void;
  close: () => void;
  ctx: GuardCtx;
  setCtx: (c: GuardCtx) => void;
  calcMode: CalcMode;
  setCalcMode: (m: CalcMode) => void;
  cellPair: CellPair;
  setCellPair: (p: CellPair) => void;
  notes: Note[];
  setNotes: (n: Note[]) => void;
}
const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({
  loaded,
  initialBench,
  initialNotes,
  initialTab,
  initialSheet,
  children,
}: {
  loaded: Loaded;
  /** a bench to start with: the app uses it for ?bench= links, tests use it to render a verdict */
  initialBench?: BenchItem[];
  /** notes to start with, for the same reason */
  initialNotes?: Note[];
  /** a deep link (?tab=, ?pair=, ?species=…): where to land and what to open over it */
  initialTab?: Tab | null;
  initialSheet?: Sheet;
  children: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "table");
  const [bench, setBench] = useState<BenchItem[]>(initialBench ?? []);
  const [sheet, setSheet] = useState<Sheet>(initialSheet ?? null);
  const [ctx, setCtxState] = useState<GuardCtx>(readCtx);
  const [calcMode, setCalcMode] = useState<CalcMode>("solution");
  const [cellPair, setCellPair] = useState<CellPair>({ a: "Zn2+/Zn", b: "Cu2+/Cu" });
  const [notes, setNotesState] = useState<Note[]>(initialNotes ?? readNotes);
  const setNotes = useCallback((n: Note[]) => {
    setNotesState(n);
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(NOTES_KEY, JSON.stringify(n));
    } catch {
      /* a private window that will not keep the notebook is allowed to forget it, but it says so */
    }
  }, []);
  const setCtx = useCallback((c: GuardCtx) => {
    setCtxState(c);
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(CTX_KEY, JSON.stringify(c));
    } catch {
      /* a private window that will not keep it is allowed to forget */
    }
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("storage", () => setCtxState(readCtx()));
  }, []);

  const open = useCallback((s: NonNullable<Sheet>) => setSheet(s), []);
  const close = useCallback(() => setSheet(null), []);
  // four slots, because a beaker takes four things before the story stops being about
  // what the user meant; the bench screen can replace an entry but not add a fifth
  const addToBench = useCallback(
    (id: string) =>
      setBench((b) =>
        b.some((x) => x.species_id === id) ? b : [...b, { species_id: id, qty: 1, unit: "g" as const }].slice(0, 4),
      ),
    [],
  );

  const value = useMemo<Ctx>(
    () => ({
      ...loaded,
      tab,
      setTab,
      bench,
      setBench,
      addToBench,
      sheet,
      open,
      close,
      ctx,
      setCtx,
      calcMode,
      setCalcMode,
      cellPair,
      setCellPair,
      notes,
      setNotes,
    }),
    [loaded, tab, bench, addToBench, sheet, open, close, ctx, setCtx, calcMode, cellPair, notes, setNotes],
  );
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp used outside AppProvider");
  return c;
}
