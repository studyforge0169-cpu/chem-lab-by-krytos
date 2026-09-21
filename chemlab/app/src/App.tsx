import { useEffect, useState } from "react";
import { loadApp, type Loaded } from "./data/load.js";
import { AppProvider, useApp, type Tab } from "./state/app.js";
import { Sheet } from "./components/Sheet.js";
import { TableScreen } from "./screens/TableScreen.js";
import { ShelfScreen } from "./screens/ShelfScreen.js";
import { BenchScreen } from "./screens/BenchScreen.js";
import { SafetyScreen } from "./screens/SafetyScreen.js";
import { CalcScreen } from "./screens/CalcScreen.js";
import { MoreScreen } from "./screens/MoreScreen.js";
import { AIScreen } from "./screens/AIScreen.js";
import { ElementSheet } from "./screens/ElementSheet.js";
import { SpeciesSheet } from "./screens/SpeciesSheet.js";
import { ReactionSheet } from "./screens/ReactionSheet.js";
import { CombinationSheet } from "./screens/CombinationSheet.js";
import { ReactionsScreen } from "./screens/ReactionsScreen.js";
import { WorkScreen } from "./screens/WorkScreen.js";
import { FindBar } from "./components/FindBar.js";
import { parseLink, buildLink } from "./lib/links.js";
import { reloadIntoNewData, shipPill } from "./lib/sw.js";
import { useShip } from "./components/Ship.js";

const TABS: { id: Tab; label: string; glyph: string }[] = [
  { id: "table", label: "Table", glyph: "⌗" },
  { id: "shelf", label: "Shelf", glyph: "⌸" },
  { id: "bench", label: "Bench", glyph: "⚗" },
  { id: "ai", label: "AI Lab", glyph: "✦" },
  { id: "calc", label: "Calc", glyph: "◊" },
  { id: "safety", label: "Safe", glyph: "⚠" },
  { id: "work", label: "Work", glyph: "☰" },
  { id: "reactions", label: "React", glyph: "⟶" },
  { id: "more", label: "Data", glyph: "ⓘ" },
];

function Shell() {
  const { store, tab, setTab, sheet, close, bench } = useApp();
  const pill = shipPill(useShip(), store.buildId);
  return (
    <div className="app">
      <header className="hdr">
        <h1>
          ChemLab
          <span className="chip">{store.counts.species} substances</span>
          <span className="chip" style={{ background: "linear-gradient(135deg,#4f46e5,#7c3aed)", color: "white", border: "none" }}>✦ AI</span>
        </h1>
        <div className="build">
          data {store.dataGenerated ? store.dataGenerated.slice(0, 10) : "?"}
          <br />
          build {String(store.buildId).slice(0, 12)}
        </div>
        {pill ? (
          <div className="ship">
            <button className="pill-btn" onClick={() => reloadIntoNewData()} title="the app keeps working offline until you do">
              {pill} · reload into it
            </button>
          </div>
        ) : null}
        <p className="link-line">
          <button
            className="link"
            onClick={(e) => {
              const href = `${location.pathname}${buildLink({ tab, bench, sheet })}`;
              navigator.clipboard?.writeText(new URL(href, location.href).href).then(
                () => (e.currentTarget.textContent = "link copied — it opens this bench, on any device with this build"),
                () => (e.currentTarget.textContent = href),
              );
            }}
          >
            copy a link to what is on screen
          </button>
          <span className="small dim"> · the link holds the bottles and the amounts, not a screenshot</span>
        </p>
        <FindBar />
      </header>
      <main>
        {tab === "table" && <TableScreen />}
        {tab === "shelf" && <ShelfScreen />}
        {tab === "bench" && <BenchScreen />}
        {tab === "ai" && <AIScreen />}
        {tab === "calc" && <CalcScreen />}
        {tab === "safety" && <SafetyScreen />}
        {tab === "reactions" && <ReactionsScreen />}
        {tab === "work" && <WorkScreen />}
        {tab === "more" && <MoreScreen />}
      </main>
      <nav className="tabs" aria-label="sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            aria-current={tab === t.id}
            onClick={() => {
              setTab(t.id);
              if (sheet) close();
            }}
          >
            <span className="glyph" aria-hidden>
              {t.glyph}
            </span>
            {t.label}
            {t.id === "reactions" && store.counts.reactions ? <span className="count">{store.counts.reactions}</span> : null}
            {t.id === "bench" && bench.length ? <span className="count">{bench.length}/4</span> : null}
            {t.id === "ai" ? <span className="count" style={{ background: "#4f46e5" }}>AI</span> : null}
          </button>
        ))}
      </nav>
      {sheet ? (
        <Sheet onClose={close} title={sheet.kind}>
          {sheet.kind === "element" ? <ElementSheet symbol={sheet.symbol} /> : null}
          {sheet.kind === "species" ? <SpeciesSheet id={sheet.id} /> : null}
          {sheet.kind === "reaction" ? <ReactionSheet id={sheet.id} /> : null}
          {sheet.kind === "combination" ? <CombinationSheet pair={sheet.pair} /> : null}
          {sheet.kind === "precip" ? (
            <p className="note">
              The precipitation row is on the bench, not in a sheet: it needs the volumes you mixed before Q means anything, so put the two solutions
              on the bench and read it there.
            </p>
          ) : null}
        </Sheet>
      ) : null}
    </div>
  );
}

export function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  // the link is read once, before the data arrives, so a cold open lands where it was pointed
  const [link] = useState(() => parseLink(typeof window === "undefined" ? "" : window.location.search));

  useEffect(() => {
    let on = true;
    loadApp(import.meta.env.BASE_URL.replace(/\/$/, "") + "/data")
      .then((l) => on && setLoaded(l))
      .catch((e) => on && setError(String(e && e.message ? e.message : e)));
    return () => {
      on = false;
    };
  }, []);

  if (error)
    return (
      <div className="err">
        <h2>The data did not load</h2>
        <p className="small">
          This app reads <code>data/chemlab.json.gz</code> next to itself. Run{" "}
          <code>npm run sync</code> in <code>chemlab/app</code> (or rebuild the warehouse) and
          reload.
        </p>
        <p>
          <code>{error}</code>
        </p>
      </div>
    );
  if (!loaded)
    return (
      <div className="load">
        <p>Inflating the warehouse…</p>
        <div className="bar">
          <i />
        </div>
        <p className="small">1.2 MB compressed, then indexed: 582 substances and 9 410 element pairs</p>
      </div>
    );
  return (
    <AppProvider loaded={loaded} initialTab={link.tab} initialBench={link.bench.length ? link.bench : undefined} initialSheet={link.sheet}>
      <Shell />
    </AppProvider>
  );
}
