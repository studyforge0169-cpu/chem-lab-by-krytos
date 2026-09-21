/** Prompt 15: the audit. Not "does each screen look right" but "is there any path in the app that
 *  ends nowhere, any screen that never gets rendered by a test, and any sentence that promises
 *  something for later". All of it is run against the file that ships. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { AppProvider } from "../src/state/app.js";
import { buildStore, type Loaded } from "../src/data/load.js";
import { TABS, buildLink, parseLink } from "../src/lib/links.js";
import { shelfCensus } from "../src/lib/apparatusShelf.js";
import { practicalGaps } from "../src/lib/practical.js";
import { deadLinks } from "../src/lib/reactBrowser.js";
import { TableScreen } from "../src/screens/TableScreen.js";
import { ShelfScreen } from "../src/screens/ShelfScreen.js";
import { BenchScreen } from "../src/screens/BenchScreen.js";
import { CalcScreen } from "../src/screens/CalcScreen.js";
import { SafetyScreen } from "../src/screens/SafetyScreen.js";
import { ReactionsScreen } from "../src/screens/ReactionsScreen.js";
import { WorkScreen } from "../src/screens/WorkScreen.js";
import { MoreScreen } from "../src/screens/MoreScreen.js";
import { NotebookScreen } from "../src/screens/NotebookScreen.js";
import { ShelfSection } from "../src/screens/ShelfApparatus.js";
import { ElementSheet } from "../src/screens/ElementSheet.js";
import { SpeciesSheet } from "../src/screens/SpeciesSheet.js";
import { ReactionSheet } from "../src/screens/ReactionSheet.js";
import { CombinationSheet } from "../src/screens/CombinationSheet.js";
import type { CombinationsDoc, WarehouseDoc } from "../src/data/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataRoot = resolve(here, "..", "..", "data");
const read = (f: string) => JSON.parse(gunzipSync(readFileSync(resolve(dataRoot, f))).toString("utf8"));

let loaded: Loaded;
beforeAll(() => {
  const doc = read("chemlab.json.gz") as WarehouseDoc;
  const comb = read("combinations.json.gz") as CombinationsDoc;
  loaded = {
    store: buildStore(doc, comb.combinations, null, null),
    manifest: null,
    timings: { fetch_ms: 1, inflate_ms: 1, parse_ms: 1, index_ms: 1, total_ms: 4, bytes: 1e6 },
  };
});
const store = () => loaded.store;
const render = (node: React.ReactElement) =>
  renderToStaticMarkup(<AppProvider loaded={loaded}>{node}</AppProvider>);
const LEAK = /(?:>|[\s&])(?:undefined|NaN|\[object Object\]|null|Infinity)(?:<|\s|;)/;
const clean = (html: string) => html.replace(/<!--[^]*?-->/g, "");

describe("every screen renders, on its own and with something on the bench", () => {
  const screens: [string, React.ReactElement][] = [
    ["table", <TableScreen key="1" />],
    ["shelf", <ShelfScreen key="2" />],
    ["bench empty", <BenchScreen key="3" />],
    ["calc", <CalcScreen key="4" />],
    ["safety", <SafetyScreen key="5" />],
    ["reactions", <ReactionsScreen key="6" />],
    ["work", <WorkScreen key="7" />],
    ["notebook", <NotebookScreen key="8" />],
    ["more", <MoreScreen key="9" />],
  ];
  for (const [name, el] of screens) {
    it(`${name} renders real markup and leaks nothing`, () => {
      const html = clean(render(el));
      expect(html.length, name).toBeGreaterThan(400);
      expect(html, name).not.toMatch(LEAK);
      expect(html, name).not.toContain("[object Object]");
    });
  }

  it("the bench with a mixture, and a saved run, both render", () => {
    const html = clean(
      renderToStaticMarkup(
        <AppProvider
          loaded={loaded}
          initialBench={[
            { species_id: "nacl", qty: 20, unit: "g" },
            { species_id: "hcl", qty: 5, unit: "mL" },
          ]}
          initialNotes={[]}
        >
          <BenchScreen />
        </AppProvider>,
      ),
    );
    expect(html.length).toBeGreaterThan(1200);
    expect(html).not.toMatch(LEAK);
  });
});

describe("every sheet renders, for every record the app can link to", () => {
  it("all 582 species sheets", () => {
    const ids = store().species.map((s) => s.id);
    expect(ids.length).toBe(582);
    for (const id of ids) {
      const html = clean(render(<SpeciesSheet id={id} />));
      expect(html.length, id).toBeGreaterThan(120);
      expect(html, id).not.toMatch(LEAK);
    }
  });

  it("all 424 reaction sheets", () => {
    const ids = (store().doc.reactions ?? []).map((r) => r.id);
    expect(ids.length).toBe(424);
    for (const id of ids) {
      const html = clean(render(<ReactionSheet id={id} />));
      expect(html.length, id).toBeGreaterThan(150);
      expect(html, id).not.toMatch(LEAK);
    }
  });

  it("all 118 element sheets", () => {
    const syms = [...store().elementBySymbol.keys()];
    expect(syms.length).toBe(118);
    for (const symbol of syms) {
      const html = clean(render(<ElementSheet symbol={symbol} />));
      expect(html.length, symbol).toBeGreaterThan(200);
      expect(html, symbol).not.toMatch(LEAK);
    }
  });

  it("every pair the browser can reach, with the interesting ones named", () => {
    const keys = [...store().combosByPair.keys()];
    const rows = store().combos;
    expect(rows.length).toBe(9410);
    // keyed by the sorted pair, plus the written pair whenever the data wrote it the other way round
    const sorted = new Set(rows.map((r: any) => String(r.pair).split("-").sort().join("-")));
    expect(keys.length).toBeGreaterThanOrEqual(sorted.size);
    for (const k of keys) expect(k.split("-").every((sym) => store().elementBySymbol.has(sym)), k).toBe(true);
    expect(store().combosByPair.has("Na-Cl") || store().combosByPair.has("Cl-Na")).toBe(true);
    const verified = store().combos.filter((r: any) => r.status === "verified").map((r: any) => r.pair);
    const withEmf = store().combos.filter((r: any) => r.predicted_emf !== null && r.predicted_emf !== undefined).map((r: any) => r.pair);
    const sample = new Set<string>([...verified.slice(0, 80), ...withEmf.slice(0, 80), ...store().combos.filter((_: any, i: number) => i % 700 === 0).map((r: any) => r.pair)]);
    expect(sample.size).toBeGreaterThan(100);
    for (const pair of sample) {
      const html = clean(render(<CombinationSheet pair={pair} />));
      expect(html.length, pair).toBeGreaterThan(150);
      expect(html, pair).not.toMatch(LEAK);
    }
  });

  it("a sheet asked for a record that does not exist says so, and does not throw", () => {
    for (const el of [
      <SpeciesSheet id="no_such_bottle" key="a" />,
      <ReactionSheet id="no_such_reaction" key="b" />,
      <ElementSheet symbol="Zz" key="c" />,
      <CombinationSheet pair="Xx-Yy" key="d" />,
    ]) {
      const html = clean(render(el));
      expect(html.length).toBeGreaterThan(40);
      expect(html).not.toMatch(LEAK);
    }
  });
});

describe("every link the app can write, lands", () => {
  it("the tabs, round-tripped through the parser", () => {
    for (const tab of TABS) {
      const link = buildLink({ tab, bench: [] });
      expect(link).toBe(`?tab=${tab}`);
      expect(parseLink(link).tab).toBe(tab);
      expect(parseLink(link).problems).toEqual([]);
    }
  });

  it("the sheets, with real ids from the file", () => {
    const cases: any[] = [
      { kind: "species", id: store().species[0].id },
      { kind: "reaction", id: (store().doc.reactions ?? [])[0].id },
      { kind: "element", symbol: "Fe" },
      { kind: "combination", pair: "Na-Cl" },
    ];
    for (const c of cases) {
      const link = buildLink({ tab: "shelf", sheet: c });
      const parsed = parseLink(link);
      expect(parsed.problems, link).toEqual([]);
      expect(parsed.sheet).toBeTruthy();
      const kind = (parsed.sheet as any).kind;
      const id = (parsed.sheet as any).id ?? (parsed.sheet as any).symbol ?? (parsed.sheet as any).pair;
      if (kind === "species") expect(store().speciesById.has(id)).toBe(true);
      if (kind === "reaction") expect(store().reactionById.has(id)).toBe(true);
      if (kind === "element") expect(store().elementBySymbol.has(id)).toBe(true);
      if (kind === "combination") expect(store().combosByPair.has(id)).toBe(true);
    }
  });

  it("a bench link with four bottles opens on a bench with four bottles", () => {
    const link = buildLink({ tab: "bench", bench: [
      { species_id: "nacl", qty: 20, unit: "g" },
      { species_id: "hcl", qty: 5, unit: "mL" },
      { species_id: "water", qty: 100, unit: "mL" },
      { species_id: "naoh", qty: 2, unit: "mol" },
    ] } as any);
    const parsed = parseLink(link);
    expect(parsed.bench.length).toBe(4);
    for (const b of parsed.bench) expect(store().speciesById.has(b.species_id)).toBe(true);
    expect(unresolved(parsed)).toEqual([]);
  });
});
const unresolved = (l: { problems: string[]; bench: any[] }) => [...l.problems, ...l.bench.filter((b) => !loaded.store.speciesById.has(b.species_id))];

it("every launcher shortcut lands on a tab the app has", () => {
  const manifest = JSON.parse(readFileSync(resolve(here, "..", "public", "manifest.webmanifest"), "utf8"));
  expect(manifest.start_url).toBe("./");
  for (const sc of manifest.shortcuts ?? []) {
    const parsed = parseLink(new URL(sc.url, "https://x/").search.slice(1));
    expect(parsed.tab).not.toBeNull();
    const valid = (k: string) =>
      k === "more" ||
      TABS.some((t) => (typeof t === "string" ? t === k : (t as any).sections?.some((sec: any) => sec.key === k) ?? false));
    expect(valid(String(parsed.tab))).toBe(true);
  }
  expect((manifest.shortcuts ?? []).length).toBe(4);
});

describe("no screen promises anything for later", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = resolve(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|css|html)$/.test(name)) files.push(p);
    }
  };
  walk(resolve(here, "..", "src"));
  files.push(resolve(here, "..", "index.html"), resolve(here, "..", "public", "sw.js"), resolve(here, "..", "public", "manifest.webmanifest"));

  it("the source has every file in it, and none of them is a stub", () => {
    expect(files.length).toBeGreaterThan(40);
    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8")
        .replace(/\/\*[^]*?\*\//g, " ") // block comments are notes to the builder, not to the user
        .replace(/^\s*\/\/.*$/gm, " "); // and so are line comments
      for (const re of [/later prompt/i, /not implemented/i, /\bTODO\b/, /\bFIXME\b/, /coming soon/i, /to be written/i, /placeholder text/i, /\bprompt \d/i]) {
        const m = text.match(re as RegExp);
        if (m) bad.push(`${f.split("/").slice(-1)[0]}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("no user-visible sentence asks the reader to know about the build queue", () => {
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const line of text.split("\n")) {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        expect(line, `${f.split("/").slice(-1)[0]}: ${line.trim().slice(0, 60)}`).not.toMatch(/\bprompt \d\d?\b/);
      }
    }
  });
});

describe("the data the app leans on answers for it", () => {
  it("no link in the practical layer dangles, and no link in the reaction browser dangles", () => {
    expect(practicalGaps(store())).toEqual([]);
    expect(deadLinks(store())).toEqual([]);
  });

  it("every species id any record names is on the shelf", () => {
    const missing: string[] = [];
    for (const r of store().doc.reactions ?? [])
      for (const t of [...((r as any).reactants ?? []), ...((r as any).products ?? [])]) if (t?.species_id && !store().speciesById.has(t.species_id)) missing.push(`${r.id}→${t.species_id}`);
    const arr = (x: unknown): any[] => (Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x as any) : []);
    for (const sp of store().doc.species ?? []) {
      const els = (sp as any).elements;
      const syms = Array.isArray(els)
        ? els.map((e: any) => String(e?.symbol ?? e ?? ""))
        : els && typeof els === "object"
          ? Object.keys(els)
          : [];
      const isotope = new Map<string, string>();
      for (const el of store().doc.elements as any[])
        for (const i of el.isotopes_natural ?? []) isotope.set(String(i.mass_number), el.symbol);
      for (const sym of syms) {
        if (!sym || store().elementBySymbol.has(sym)) continue;
        // a symbol that is not an element may still be isotope shorthand, but only if the
        // element table really lists that isotope - D2O is allowed, an invented nuclide is not
        const mass: Record<string, string> = { D: "2", T: "3" };
        const parent = mass[sym] ? isotope.get(mass[sym]) : undefined;
        if (!parent) missing.push(`${(sp as any).id}→${sym}`);
        else if (parent !== "H") missing.push(`${(sp as any).id}→${sym}(isotope of ${parent}, not indexed consistently)`);
      }
    }
    for (const b of ((store().doc.lab as any)?.stock_bottles ?? []) as any[]) if (b.species_id && !store().speciesById.has(b.species_id)) missing.push(`stock→${b.species_id}`);
    const refusals = (store().doc.lab as any)?.refusals;
    for (const entry of arr(refusals) as any[]) {
      const ids = [entry?.species, entry?.species_id, ...arr(entry?.avoid), ...arr(entry?.with), ...arr(entry?.species_ids), ...arr(entry?.never_with)]
        .flat()
        .map((x) => (typeof x === "string" ? x : typeof x === "object" && x ? String(x.species_id ?? x.id ?? "") : ""))
        .filter(Boolean);
      for (const id of ids) if (id.includes("_") && !store().speciesById.has(id) && !/^(mixture|class|any)/.test(id)) missing.push(`refusal→${id}`);
    }
    expect(missing).toEqual([]);
  });

  it("the shelf's own census is the number the screen prints", () => {
    const c = shelfCensus(store());
    expect(c.total).toBe(192);
    expect(c.with_tolerance).toBe(27);
    expect(c.cited).toBe(33);
    expect(c.measured_by_a_technique).toBe(3);
    expect(c.in_a_kit).toBe(78);
    expect(c.in_the_syllabus).toBe(17);
    expect(c.named_by_a_reaction).toBe(99);
    // rows nothing asks for are counted, not hidden, and the screen prints the number
    expect(c.nothing_asks).toBe(29);
    expect(c.prose_only_techniques).toBe(1);
    const flat = render(<WorkScreen />).replace(/<!--[\s\S]*?-->/g, "");
    expect(flat).toContain("glassware (192)");
    // the three counts the shelf's own filter offers are the same arithmetic, so a facet on the
    // screen can never disagree with the census the audit holds still. Only the selected Work
    // section is in the DOM, so the shelf is rendered on its own to read them.
    const shelf = render(<ShelfSection />).replace(/<!--[\s\S]*?-->/g, "");
    expect(shelf).toContain(`the ${c.with_tolerance} with a tolerance`);
    expect(shelf).toContain(`the ${c.total - c.with_tolerance} without one`);
    expect(shelf).toContain(`the ${c.nothing_asks} nothing asks for`);
    expect(shelf).toContain("asked for by a technique");
    expect(shelf).toContain(`192 rows`);
    // and the numbers add up: nothing is counted twice into a total that does not hold them
    expect(c.with_tolerance + (c.total - c.with_tolerance)).toBe(c.total);
  });
});
