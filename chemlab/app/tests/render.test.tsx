/** Render tests, because the acceptance criterion for the shelf was "every species renders
 *  its sheet without an exception" - and that is only worth saying if something checks it.
 *  These run the real screens against the real shipped file. */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { AppProvider } from "../src/state/app.js";
import type { Loaded } from "../src/data/load.js";
import { buildStore } from "../src/data/load.js";
import { TableScreen } from "../src/screens/TableScreen.js";
import { ShelfScreen } from "../src/screens/ShelfScreen.js";
import { BenchScreen } from "../src/screens/BenchScreen.js";
import { SolutionsPanel } from "../src/screens/Panels.js";
import { CalcScreen } from "../src/screens/CalcScreen.js";
import { CellMode, SeriesMode } from "../src/screens/CellModes.js";
import { SafetyScreen } from "../src/screens/SafetyScreen.js";
import { ReactionSheet } from "../src/screens/ReactionSheet.js";
import { STARTERS } from "../src/screens/BenchScreen.js";
import { guardReaction, DEFAULT_CTX } from "../src/lib/guard.js";
import { ElementSheet } from "../src/screens/ElementSheet.js";
import { SpeciesSheet } from "../src/screens/SpeciesSheet.js";
import { filterShelf, DEFAULT_QUERY } from "../src/lib/filters.js";
import { CombosScreen, ComboEmfChain } from "../src/screens/CombosScreen.js";
import { CombinationSheet } from "../src/screens/CombinationSheet.js";
import { NotebookScreen } from "../src/screens/NotebookScreen.js";
import { ReactionsScreen } from "../src/screens/ReactionsScreen.js";
import {
  Kits,
  Schemes,
  Syllabus,
  Techniques,
  Trouble,
  WorkScreen,
} from "../src/screens/WorkScreen.js";
import { FindBar, FindCounts, FindResults } from "../src/components/FindBar.js";
import { searchAll } from "../src/lib/searchAll.js";
import {
  anionScheme,
  cationScheme,
  curriculum,
  kits,
  organicTests,
  paperTests,
  techniques,
  troubleshooting,
} from "../src/lib/practical.js";
import { openTarget } from "../src/lib/searchAll.js";
import { captureNote } from "../src/lib/notebook.js";
import { decideMix } from "../src/lib/mix.js";
import type { BenchItem } from "../src/state/app.js";
import type { CombinationsDoc, WarehouseDoc } from "../src/data/types.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const read = (f: string) => JSON.parse(gunzipSync(readFileSync(resolve(root, f))).toString("utf8"));

let loaded: Loaded;
beforeAll(() => {
  const doc = read("chemlab.json.gz") as WarehouseDoc;
  const comb = read("combinations.json.gz") as CombinationsDoc;
  loaded = {
    store: buildStore(doc, comb.combinations, null),
    manifest: null,
    timings: { fetch_ms: 1, inflate_ms: 1, parse_ms: 1, index_ms: 1, total_ms: 4, bytes: 1e6 },
  };
});
const render = (node: React.ReactElement, initialBench?: any[], initialNotes?: any[]) =>
  renderToStaticMarkup(
    <AppProvider loaded={loaded} initialBench={initialBench} initialNotes={initialNotes}>
      {node}
    </AppProvider>,
  );

describe("the bench with a real mixture on it", () => {
  it("renders the verdict and every computed panel under it", () => {
    const bench = [
      { species_id: "h2gas", qty: 4.032, unit: "g" },
      { species_id: "o2", qty: 64, unit: "g" },
    ];
    const html = render(<BenchScreen />, bench);
    expect(html).toContain("how much"); // quantities panel
    expect(html).toContain("heat");
    expect(html).toContain("gas");
    expect(html).toContain("36.03"); // the stoichiometric mass of water, computed not copied
    expect(html).toContain("571.66"); // the record's own DH, quoted with its provenance
    expect(html).toContain("prov-computed"); // and styled as computed, never like a measurement
    expect(html).toContain("extent × coefficient × molar mass"); // with the basis it came from
    expect(html).toContain("boils long before"); // and the caveat when the arithmetic outruns the beaker
    expect(html).not.toMatch(/(?:>|\s)(?:undefined|NaN)(?:<|\s)/);
    expect(html).not.toContain("[object Object]");
    const solutions = render(<SolutionsPanel />);
    expect(solutions).toContain("making a solution");
    expect(solutions).toContain("mol/L");
  });

  it("puts an ion pair through Q against Ksp at the volumes on the bench", () => {
    const bench = [
      { species_id: "agno3", qty: 25, unit: "mL", molarity: 0.1 },
      { species_id: "nacl", qty: 25, unit: "mL", molarity: 0.1 },
    ] as any[];
    const html = render(<BenchScreen />, bench);
    expect(html).toContain("at these volumes");
    expect(html).toContain("the beaker holds 50 mL");
    expect(html).toContain("Q =");
    expect(html).toMatch(/comes down|stays in solution|too close to call/);
    expect(html).toMatch(/Ksp = [0-9.]+e-\d+ for AgCl/); // the constant, with its own source line
    expect(html).not.toMatch(/(?:>|\s)(?:undefined|NaN)(?:<|\s)/);
    expect(html).not.toContain("[object Object]");
  });
});

describe("the calc screen", () => {
  it("draws the solution mode without an undefined in sight", () => {
    const html = render(<CalcScreen />);
    expect(html).toContain("a solution");
    expect(html).toContain("a cell"); // the two electrochemistry modes share this tab
    expect(html).toContain("the series");
    expect(html).toContain("pH, computed");
    expect(html).toContain("2.88"); // 0.1 M acetic, from the pKa on the record
    expect(html).not.toMatch(/(?:>|\s)(?:undefined|NaN)(?:<|\s)/);
    expect(html).not.toContain("[object Object]");
  });

  it("builds the Daniell cell from the shipped potentials", () => {
    const html = render(<CellMode pair={{ a: "Zn2+/Zn", b: "Cu2+/Cu" }} setPair={() => {}} />);
    expect(html).toContain("1.104"); // V, the pair the book opens with
    expect(html).toContain("n = 2");
    expect(html).toContain("anode");
    expect(html).toContain("cathode");
    expect(html).toContain("curated (CRC 97th electrode table)"); // the provenance line, next to the value
    expect(html).not.toMatch(/(?:>|\s)(?:undefined|NaN)(?:<|\s)/);
    expect(html).not.toContain("[object Object]");
  });

  it("says so when the table cannot balance a half equation", () => {
    const html = render(<CellMode pair={{ a: "CuCl/Cu", b: "Zn2+/Zn" }} setPair={() => {}} />);
    expect(html).toContain("not printed");
    expect(html).toContain("n not derivable");
    expect(html).not.toContain("NaN");
  });

  it("walks the displacement series and reaches the element-pair rows", () => {
    const html = render(<SeriesMode onPair={() => {}} />);
    expect(html).toContain("comes down");
    expect(html).toContain("stays in");
    expect(html).toContain("703");
    expect(html).toContain("standard-state");
    expect(html).not.toMatch(/(?:>|\s)(?:undefined|NaN)(?:<|\s)/);
  });

  it("does not invent a pair that is not in the table", () => {
    const html = render(<CellMode pair={{ a: "nope/nope", b: "Cu2+/Cu" }} setPair={() => {}} />);
    expect(html).toContain("half-cell table");
  });
});

const strip = (h: string) => h.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&[a-z]+;/g, " ");

describe("the guard on the safety tab", () => {
  it("shows the guard's working, the refusals and the limits, with no broken text", () => {
    const html = strip(render(<SafetyScreen />));
    expect(html).toContain("where the work is actually happening");
    expect(html).toContain("what this app will not print");
    expect(html).toContain("synthesis of explosives"); // lab.refusals, quoted
    expect(html).toContain("policy, not nature"); // the limit table's own note
    expect(html).toContain("first aid, as the data has it");
    expect(html).toContain("phenol on the skin");
    expect(html).toContain("anhydrous"); // a waste class name, from lab.waste_classes
    expect(html).toMatch(/16 of 23|\d+ of 23/); // which mixing rules the app can enforce
    for (const bad of ["undefined", "NaN", "[object Object]", ">null<", " null "]) expect(html).not.toContain(bad);
  });

  it("carries the bench into the verdict, including what the guard withheld from it", () => {
    const bench = [
      { species_id: "naclo", qty: 50, unit: "mL" as const },
      { species_id: "hcl", qty: 5, unit: "mL" as const },
    ];
    const html = strip(render(<BenchScreen />, bench));
    expect(html).toContain("the guard, before anything else");
    expect(html).toContain("refused");
    expect(html).toContain("bleach + acid");
    // a refused bench gets no arithmetic at all: the numbers that would tell you how much to weigh
    // are the part the guard withholds, and the screen has to say it withheld them
    expect(html).toContain("no quantities on this bench");
    expect(html).toContain("shown without any numbers");
    expect(html).not.toContain("limiting");
  });

  it("withholds the quantities when the record forbids a scale", () => {
    const bench = [
      { species_id: "zn", qty: 1, unit: "g" as const },
      { species_id: "cuso4", qty: 1, unit: "g" as const },
    ];
    const allowed = strip(render(<BenchScreen />, bench));
    expect(allowed).toContain("how much");
    expect(allowed).toContain("limiting");
    expect(allowed).not.toContain("no quantities on this bench");
  });
});

describe("a reaction record, with the guard in front of it", () => {
  it("prints the ordinary record in full", () => {
    const html = strip(render(<ReactionSheet id="syn_h2o" />));
    expect(html).toContain("Burning hydrogen to water");
    expect(html).toContain("pop");
    expect(html).toContain("H₂ + O₂");
    expect(html).toContain("put the 2 reactants on the bench");
    expect(html).toContain("kJ");
    expect(html).not.toContain("what is not printed here");
  });

  it("refuses the household bleach mixes and says what it is withholding", () => {
    const acid = strip(render(<ReactionSheet id="app_bleach_acid_warning" />));
    const ammonia = strip(render(<ReactionSheet id="app_bleach_ammonia" />));
    for (const html of [acid, ammonia]) {
      expect(html).toContain("what is not printed here");
      expect(html).toContain("refused");
      expect(html).not.toContain("put the");
      expect(html).not.toContain("g per mole of reaction");
      expect(html).not.toContain("hard-stop-warning;"); // the raw field it was parsed from, never echoed
      expect(html).not.toContain("[object Object]");
      expect(html).toContain("no citation sits on this record"); // reference is extras, not a source
    }
    expect(acid).toContain("NaClO + 2 HCl"); // the equation and the harm stay on screen
    expect(ammonia).toContain("chloramine");
  });

  it("suppresses the route on every record the data marks display-only, and on no others", () => {
    const st = loaded.store;
    const suppressed = st.reactions.filter((r) => guardReaction(r, st, DEFAULT_CTX).hide_scale);
    const allowed = st.reactions.filter((r) => !guardReaction(r, st, DEFAULT_CTX).hide_scale);
    expect(suppressed.length).toBeGreaterThan(15);
    expect(allowed.length).toBeGreaterThan(300);
    const leaks: string[] = [];
    for (const r of suppressed) {
      const html = strip(render(<ReactionSheet id={r.id} />));
      if (!html.includes("what is not printed here")) leaks.push(`${r.id}: no statement of what was withheld`);
      if (html.includes("g per mole of reaction")) leaks.push(`${r.id}: a quantity to weigh out`);
      for (const a of ((r as any).safety?.apparatus ?? []) as string[])
        if (a.length > 3 && html.includes(a)) leaks.push(`${r.id}: the apparatus "${a}"`);
    }
    expect(leaks).toEqual([]);
    // and an ordinary record still says what you would need: suppression is not the default
    const plain = strip(render(<ReactionSheet id="syn_h2o" />));
    expect(plain).toContain("what the record says you need");
    expect(plain).toContain("eudiometer");
  });
});

describe("the starters", () => {
  it("only name substances the warehouse actually has", () => {
    const missing: string[] = [];
    for (const st of STARTERS) for (const id of st.ids) if (!loaded.store.speciesById.has(id)) missing.push(`${st.label}: ${id}`);
    expect(missing).toEqual([]);
  });
});

describe("the periodic table screen", () => {
  it("draws 118 tiles and the honesty markers", () => {
    const html = render(<TableScreen />);
    expect((html.match(/class="tile/g) ?? []).length).toBe(118);
    expect(html).toContain("dot-pred"); // the Z>=100 dot
    expect(html).toContain("1.008"); // hydrogen's mass, from the record
    expect(html).toContain("lanthanides");
  });
});

describe("the shelf", () => {
  it("renders, filters and sorts", () => {
    const html = render(<ShelfScreen />);
    expect(html).toContain("shelf-row");
    const all = filterShelf(loaded.store, DEFAULT_QUERY, 1000);
    expect(all.length).toBe(582);
    expect(filterShelf(loaded.store, { ...DEFAULT_QUERY, kind: "mixture" }, 1000).length).toBe(21); // 19 mixtures + 2 polymers
    // the curated scale stops at 5 and only one record is a 5: the filter must show the
    // truth of the distribution rather than pretend there is a pile of hazards
    const hz3 = filterShelf(loaded.store, { ...DEFAULT_QUERY, hazard: 3, sort: "hazard" }, 1000);
    expect(hz3.length).toBe(48);
    expect(hz3[0]!.hazard_score).toBe(5);
    expect(filterShelf(loaded.store, { ...DEFAULT_QUERY, hazard: 4 }, 1000).length).toBe(1);
    const ions = filterShelf(loaded.store, { ...DEFAULT_QUERY, kind: "aqueous_ion" }, 1000);
    expect(ions.length).toBe(53);
    // the point of the weighable filter: 90 records have no formula to put on a balance
    const w = filterShelf(loaded.store, { ...DEFAULT_QUERY, weighable: true, q: "" }, 1000);
    expect(w.length).toBe(582 - 90);
  });
});

describe("every record renders", () => {
  it("all 582 species sheets, with no exception and no undefined text", () => {
    const bad: string[] = [];
    for (const s of loaded.store.species) {
      try {
        const html = render(<SpeciesSheet id={s.id} />);
        if (/\[object Object\]|(?:>|\s)undefined(?:<|\s)|(?:>|\s)NaN(?:<|\s| )/.test(html))
          bad.push(`${s.id}: rendered junk`);
      } catch (e) {
        bad.push(`${s.id}: ${(e as Error).message}`);
      }
    }
    expect(bad.slice(0, 6)).toEqual([]);
    expect(bad).toHaveLength(0);
  });
  it("the three hardest element records", () => {
    for (const sym of ["Fe", "As", "Og", "Tc", "C", "H"]) {
      const html = render(<ElementSheet symbol={sym} />);
      expect(html, sym).toContain("es-head");
      expect(html, sym).not.toMatch(/>NaN</);
    }
    expect(render(<ElementSheet symbol="As" />)).toContain("sublimes");
    expect(render(<ElementSheet symbol="Og" />)).toContain("Predicted, not measured");
    expect(render(<ElementSheet symbol="Tc" />)).toContain("≈");
    expect(render(<ElementSheet symbol="C" />)).toContain("no measured value");
    expect(render(<ElementSheet symbol="C" />)).toContain("1086.5"); // the IE series, not an empty table
  });
  it("says so when a record cannot be weighed", () => {
    expect(render(<SpeciesSheet id="petrolether" />)).toContain("No stoichiometry from this record");
  });
});

describe("the pair browser and the notebook", () => {
  const store = () => loaded.store as any;
  /* the notebook keeps the data's sentences, and those sentences carry quotes, which the HTML
     writer turns into entities: compare both sides after flattening, not against raw source text */
  const flat = (t: string) =>
    t.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/g, " ").replace(/["""]/g, " ").replace(/\s+/g, " ").trim();

  it("the shelf offers both files it holds", () => {
    const html = render(<ShelfScreen />);
    expect(html).toContain("the shelf");
    expect(html).toContain("every pair");
    expect(html).not.toMatch(/(?:>|\s)(?:undefined|NaN)(?:<|\s)/);
  });

  it("lists the rows, counts them, and explains the status words", () => {
    const html = strip(render(<CombosScreen />));
    expect(html).toContain("every pair of elements");
    expect(html).toContain("9,410");
    expect(html).toContain("verified (72)");
    expect(html).toContain("predicted (5789)");
    expect(html).toContain("none (3546)");
    expect(html).toContain("has an emf (156)");
    expect(html).toContain("every pair in the file: 9410");
    expect(html).toContain("a phone screen is not a spreadsheet");
    // the legend is printed, not summarised away
    expect(html).toContain("the valence rules give the formula");
    expect(html).toContain("the row carries the sentence for why");
    expect(html).not.toMatch(/undefined|\[object Object\]/);
  });

  it("shows the reason on rows that carry no verdict", () => {
    const html = strip(render(<CombosScreen />));
    expect(html).toContain("no binary standard couple");
  });

  it("prints one pair with its provenance and its chain", () => {
    const html = strip(render(<CombinationSheet pair="Na-Cl" />));
    expect(html).toContain("NaCl");
    expect(html).toMatch(/58\.44\s+g\/mol/);
    expect(html).toMatch(/Δχ\s+2\.23/);
    expect(html).toMatch(/%\s*ionic\s+71\.2\s+%/);
    expect(html).toContain("4.068 V");
    expect(html).toContain("68.8");
    expect(html).toContain("combination strongly favoured");
    expect(html).toContain("Sodium chloride (common salt)");
    expect(html).toContain("rule of thumb"); // the ionic-character number says what kind of number it is
    expect(html).toContain("computed from CIAAW atomic weights");
    expect(html).toContain("the emf chain on this row");
    expect(html).toContain("Na+/Na");
    expect(html).toContain("Cl2/Cl-");
    // neither is a metal strip the app can set up, and it says so instead of claiming a cell
    expect(html).toContain("not both elements are metal strips");
    expect(html).not.toMatch(/undefined|NaN|\[object Object\]/);
  });

  it("keeps an empirical row's honesty about which record it borrowed", () => {
    const html = strip(render(<CombinationSheet pair="B-H" />));
    expect(html).toContain("empirical");
    expect(html).toContain("Diborane (reference only)");
    expect(html).toContain("same atoms in the same ratio");
    expect(html).toContain("BH₃");
    expect(html).toContain("B2H6");
    // and the sentence that explains the borrowing knows this row is not a verified one
    expect(html).toContain("the empirical ratio of that record");
  });

  it("says plainly when a pair has no row", () => {
    const html = strip(render(<CombinationSheet pair="Xx-Yy" />));
    expect(html).toContain("no row for that pair");
    expect(html).toContain("will not describe a pair it has no row for");
  });

  it("renders the emf chain of a row that has one and nothing for a row that has none", () => {
    const withEmf = store().combos.find((c: any) => c.predicted_emf);
    const html = strip(renderToStaticMarkup(<ComboEmfChain raw={withEmf} />));
    expect(html).toContain("the emf chain on this row");
    expect(html).toContain("computed here"); // the row's own basis, not somebody's measurement
    expect(html).toContain("aqueous standard-state arithmetic");
    expect(strip(renderToStaticMarkup(<ComboEmfChain raw={store().combos.find((c: any) => !c.predicted_emf)} />))).toBe("");
  });

  it("the notebook on an empty device says so", () => {
    const html = strip(render(<NotebookScreen />));
    expect(html).toContain("nothing saved yet");
    expect(html).toContain("0 saved run");
    expect(html).toContain("export as JSON");
    expect(html).toContain("import a file");
    expect(html).toContain("Nothing is uploaded anywhere");
  });

  it("a saved run comes back with its verdict and its refusal findings", () => {
    const bench: BenchItem[] = [
      { species_id: "nacl", qty: 20, unit: "g" },
      { species_id: "kno3", qty: 10, unit: "g" },
    ];
    const mix = decideMix(bench, loaded.store, DEFAULT_CTX);
    const note = captureNote(bench, loaded.store, DEFAULT_CTX, { mix });
    const html = strip(render(<NotebookScreen />, undefined, [note]));
    expect(html).toContain("1 saved run");
    expect(html).toContain("Sodium chloride");
    expect(html).toContain("put it back on the bench");
    expect(html).toContain("the verdict as it was saved");
    expect(html).toContain("clear");
    expect(html).toContain("build ");
    expect(flat(html)).toContain(flat(mix.statusLine));
    expect(html).not.toMatch(/undefined|\[object Object\]/);
  });

  it("a blocked bench keeps its refusal in the note", () => {
    const bench: BenchItem[] = [
      { species_id: "naclo", qty: 50, unit: "mL" },
      { species_id: "hcl", qty: 5, unit: "mL" },
    ];
    const mix = decideMix(bench, loaded.store, DEFAULT_CTX);
    const note = captureNote(bench, loaded.store, DEFAULT_CTX, { mix });
    const html = strip(render(<NotebookScreen />, undefined, [note]));
    expect(html).toContain("refused");
    expect(html).toContain("what the guard said");
    expect(html).toContain("bleach");
    // the withheld amounts stay withheld
    expect(html).not.toContain("mol ·");
    const list = render(<BenchScreen />, bench);
    expect(list).toContain("no quantities on this bench");
  });

  it("the bench offers to save what it just decided", () => {
    const html = strip(render(<BenchScreen />, [{ species_id: "nacl", qty: 20, unit: "g" }]));
    expect(html).toContain("save this to the notebook");
    expect(html).toContain("the notebook");
    expect(html).toContain("data build");
  });
});

describe("the reactions browser (prompt 13)", () => {
  it("shows the file's own counts on the buttons it filters with", () => {
    const html = render(<ReactionsScreen />);
    const flat = strip(html);
    expect(flat).toContain("424 records");
    expect(flat).toContain("a balanced equation (207)");
    expect(flat).toContain("you must not do this (2)");
    expect(flat).toContain("gives off a gas (64)");
    expect(flat).toContain("needs a fume hood (4)");
    expect(flat).toContain("every record in the file: 424");
    expect(flat).toContain("any category (67 words in use)");
  });

  it("renders one row per record up to the cap, each naming what it can answer", () => {
    const html = render(<ReactionsScreen />);
    expect((html.match(/class="rx-row/g) || []).length).toBe(120);
    const flat = strip(html);
    expect(flat).toContain("Burning hydrogen to water");
    // the row prints the record's ΔH and where it came from, never a bare number
    expect(flat).toMatch(/ΔH[^\n]{0,20}kJ/);
    expect(flat).toContain("re-added from the ΔfH ledger");
    expect(flat).toContain("show 360");
    // and the census table below is the same arithmetic in words
    expect(flat).toContain("a refusal");
    expect(flat).toContain("2/424");
    expect(flat).toContain("a curriculum appearance");
  });

  it("prints no dead-link warning, because the register answers every name now", () => {
    const flat = strip(render(<ReactionsScreen />));
    expect(flat).not.toContain("would go nowhere");
    expect(flat).not.toContain("a gap in the data");
    expect(flat).toContain("names the apparatus (141)");
  });

  it("no reaction row is an empty shell, and every row id opens the sheet", () => {
    const html = render(<ReactionsScreen />);
    expect(html).not.toMatch(/(?:>|\s)(?:undefined|NaN|\[object object\]|null)(?:<|\s)/i);
    const ids = (html.match(/open\("reaction","([a-z0-9_]+)"\)/g) || []).length;
    // rows are buttons, not anchors: check the ids exist through the store instead
    const store = loaded.store;
    for (const r of store.doc.reactions ?? []) if (html.includes(`<span class="rx-name">${r.name}</span>`)) expect(store.reactionById.has(r.id)).toBe(true);
    expect(ids).toBe(0);
  });
});

describe("the one search box (prompt 13)", () => {
  it("is quiet until you type, and the box says what it covers", () => {
    const html = render(<FindBar />);
    expect(html).toContain("role=\"searchbox\"");
    expect(html).toContain("CAS number");
    expect(html).not.toContain("find-hits");
    expect(html).not.toContain("hit");
  });

  it("lists hits with their kind, and says so when nothing matches", () => {
    const page = searchAll(loaded.store, [], "nacl");
    const html = strip(render(<FindResults q="nacl" page={page} onPick={() => {}} />));
    // every hit prints its kind, because "NaCl" the bottle and "NaCl" the pair are different claims
    expect(html).toContain("species");
    expect(html).toContain("pair");
    expect(html).toContain("Sodium chloride (common salt)");
    expect(html).toContain("verified");
    const none = strip(render(<FindResults q="zzqxq" page={searchAll(loaded.store, [], "zzqxq")} onPick={() => {}} />));
    expect(none).toContain("nothing in the warehouse matches");
    expect(none).toContain("it will not guess past that");
  });

  it("counts by kind, admits a multi-word query is a word set, and reports the cap", () => {
    const html = strip(render(<FindCounts q="nacl" page={searchAll(loaded.store, [], "nacl")} />));
    expect(html).toMatch(/40 hits: 8 bottles on the shelf, 31 reaction records, 1 element pair(?!,)/);
    const many = strip(render(<FindCounts q="e" page={searchAll(loaded.store, [], "e", 10)} />));
    expect(many).toContain("not listed, narrow it");
    const words = strip(render(<FindCounts q="sodium chloride" page={searchAll(loaded.store, [], "sodium chloride")} />));
    expect(words).toContain("at least one of those words");
  });

  it("a hit routes to a record that exists, and a note routes to the bench", () => {
    const note = captureNote([{ species_id: "nacl", qty: 20, unit: "g" }], loaded.store, { hood: false, supervised: false, room_flammable_mL: 0 });
    const page = searchAll(loaded.store, [note], "sodium chloride");
    const species = page.hits.find((h) => h.kind === "species" && h.id === "nacl")!;
    expect(openTarget(loaded.store, species)).toEqual({ ok: true, sheet: { kind: "species", id: "nacl" } });
    const noteHit = page.hits.find((h) => h.kind === "note")!;
    expect(openTarget(loaded.store, noteHit)).toEqual({ ok: true, note: note.id });
  });
});

describe("the practical-work layer (prompt 14)", () => {
  it("opens on the cation tree, with the register's own numbers beside the glassware", () => {
    const flat = strip(render(<WorkScreen />));
    expect(flat).toContain("7 cation groups");
    expect(flat).toContain("group I");
    expect(flat).toContain("white needles, soluble in hot water");
    expect(flat).toContain("must come FIRST");
    // the mismatch the data makes visible: a "dilute" instruction, a concentrated bottle
    expect(flat).toContain("the app will not pretend the bottle is what the text asked for");
    // group VI's confirmations are keyed by ion in the data, and the key is shown, not flattened
    expect(flat).toContain("K+:");
    expect(flat).toContain("lilac flame through cobalt glass");
    // and with the register complete there is nothing to admit
    expect(flat).not.toContain("are not in ");
    expect(flat).not.toContain("3 references");
    expect(flat).not.toContain("[object Object]");
  });

  it("every bottle a scheme names is one the shelf carries", () => {
    const flat = strip(render(<WorkScreen />));
    expect(flat).toContain("put the bottle on the bench");
    expect(flat).toMatch(/HCl → put the bottle on the bench/);
  });

  it("each section renders on its own, and none of them renders an undefined", () => {
    const t = techniques(loaded.store);
    const cur = curriculum(loaded.store);
    const body: [string, React.ReactElement][] = [
      ["techniques", <Techniques rows={t} key="t" />],
      ["kits", <Kits rows={kits(loaded.store)} techniques={t} key="k" />],
      ["syllabus", <Syllabus groups={cur} key="s" />],
      ["when it goes wrong", <Trouble rows={troubleshooting(loaded.store)} key="r" />],
      [
        "schemes",
        <Schemes cation={cationScheme(loaded.store)} anion={anionScheme(loaded.store)} organic={organicTests(loaded.store)} paper={paperTests(loaded.store)} key="sc" />,
      ],
    ];
    for (const [name, el] of body) {
      const html = render(el);
      expect(html.length, name).toBeGreaterThan(200);
      expect(html, name).not.toMatch(/(?:>|\s)(?:undefined|NaN|\[object object\])(?:<|\s)/);
    }
    const tech = strip(render(<Techniques rows={t.filter((x) => x.id === "sublimation" || x.id === "filtration")} />)).toLowerCase();
    expect(tech).toContain("inverted funnel"); // the register's own row, quoted with its label
    expect(tech).toContain("porcelain dish"); // and the words the technique used, kept as prose
    expect(tech).toContain("no tolerance in the register");
    expect(tech).toContain("in prose, not by register id");
    const syl = strip(render(<Syllabus groups={cur} />));
    expect(syl).toContain("the syllabus entry gives no amounts");
    expect(syl).toContain("about 40 min");
    expect(syl).toContain("put on the bench");
    // the melting-point bath and its capillaries are register rows now, quoted with the truth that
    // they carry no tolerance
    expect(syl).toContain("Thiele Tube");
    expect(syl).toContain("no tolerance in the register");
    expect(syl).not.toContain("the register has no row for them");
    const k = strip(render(<Kits rows={kits(loaded.store)} techniques={t} />));
    expect(k).toContain("titration · 9 in the register, 0 not");
    expect(k).toContain("the techniques that use it:");
    expect(k).toContain("no technique in");
    expect(k).toContain("names any of these items by register id");
    const tr = strip(render(<Trouble rows={troubleshooting(loaded.store)} />));
    expect(tr).toContain("your titration overshot");
    expect(tr).toContain("Titration");
  });
});
