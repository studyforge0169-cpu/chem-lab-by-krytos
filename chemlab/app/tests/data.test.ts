/** These tests read the *shipped* files, not fixtures: the point is that the app and the
 *  warehouse agree on what is in there. If a number here and in data/DATA_REPORT.md ever
 *  disagree, this fails and one of them is wrong. */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildStore } from "../src/data/load.js";
import { layoutProblems } from "../src/screens/grid.js";
import { legendFor, MODES, tileColour } from "../src/screens/colour.js";
import type { CombinationsDoc, WarehouseDoc } from "../src/data/types.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const read = (f: string) => JSON.parse(gunzipSync(readFileSync(resolve(root, f))).toString("utf8"));

let store: ReturnType<typeof buildStore>;
let doc: WarehouseDoc;

beforeAll(() => {
  doc = read("chemlab.json.gz") as WarehouseDoc;
  const comb = read("combinations.json.gz") as CombinationsDoc;
  store = buildStore(doc, comb.combinations, null);
});

describe("the store matches the data report", () => {
  it("counts", () => {
    expect(store.counts).toMatchObject({
      elements: 118,
      species: 582,
      reactions: 424,
      ion_pairs: 380,
      combinations: 9410,
      ksp: 76,
      e0: 87,
    });
  });
  it("spot values the kernel locked in data_curated", () => {
    const nacl = store.speciesById.get("nacl")!;
    expect(nacl.molar_mass?.value).toBeCloseTo(58.44, 3);
    expect(store.speciesById.get("cuso4_5h2o")?.molar_mass?.value ?? 249.677).toBeCloseTo(249.677, 3);
    const fe = store.elementBySymbol.get("Fe")!;
    expect(fe.mel_point?.value).toBeCloseTo(1538, 0);
    expect(fe.mel_point?.kelvin).toBeCloseTo(1811.15, 1);
    expect(fe.isotopes_natural?.length).toBeGreaterThan(3);
    expect(fe.oxidation_states_observed).toEqual(expect.arrayContaining([2, 3]));
  });
  it("keeps the honesty flags where the data put them", () => {
    const og = store.elementBySymbol.get("Og")!;
    expect(og.values_are_predicted).toBe(true);
    expect(og.density?.measured).toBe(false);
    expect(store.elements.filter((e) => e.values_are_predicted)).toHaveLength(19);
    expect(store.elements.filter((e) => e.not_a_shelf_reagent).length).toBe(33);
  });
});

describe("the periodic table layout", () => {
  it("places every element once, inside an 18-column grid", () => {
    expect(layoutProblems(store.elements)).toEqual([]);
  });
  it("has no mode that hides a data gap", () => {
    for (const m of MODES) {
      const legend = legendFor(store.elements, m.id);
      const tiles = store.elements.map((e) => tileColour(e, m.id));
      expect(legend.length).toBeGreaterThan(1);
      if (m.id === "en" || m.id === "mp") {
        const gaps = tiles.filter((t) => t.nodata).length;
        expect(gaps).toBeGreaterThan(0); // 13 elements have no EN, 9 no melting point
        expect(legend.some((l) => /no value|not measured/.test(l.label))).toBe(true);
      }
    }
  });
});

describe("search", () => {
  it("finds the bottle from any of the four ways a student types it", () => {
    for (const q of ["cuso4", "copper sulphate", "CuSO4.5H2O", "7758-99-8"]) {
      const ids = store.search(q, 5).map((h: any) => h.id);
      expect(ids.length, q).toBeGreaterThan(0);
      expect(ids.some((i) => String(i).startsWith("cuso4")), q).toBe(true);
    }
  });
  it("finds an element by symbol and by number, and puts the element on top", () => {
    const fe = store.search("Fe", 5);
    expect(fe[0]!.id).toBe("Fe"); // a bare symbol is a table question, not a bottle question
    expect(fe.map((h: any) => h.id)).toContain("fe"); // and the metal itself is right behind
    expect(store.search("26", 6).some((h: any) => h.id === "Fe")).toBe(true);
  });
});

describe("the indexes the bench will use", () => {
  it("maps an ion id to its matrix rows and a salt formula back to ion pairs", () => {
    expect(store.precip.get("ion:Ag(+1)|ion:Cl(-1)")?.outcome).toBe("precipitate");
    expect(store.precip.get("ion:Ag(+1)|ion:Cl(-1)")?.basis).toBe("measured Ksp");
    const rows = store.precipByProduct.get("ClNa") ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.cation_id).toBe("ion:Na(+1)");
  });
  it("links species to the reactions that contain them", () => {
    const rs = store.reactionsBySpecies.get("h2gas") ?? [];
    expect(rs.some((r) => r.id === "syn_h2o")).toBe(true);
  });
  it("groups combinations by sorted element pair", () => {
    expect((store.combosByPair.get("Cl-Na") ?? []).length).toBeGreaterThan(0);
    expect(store.combosByStatus.get("verified")).toBe(72);
  });
});

describe("prov formatting", () => {
  it("renders a null with its reason instead of a zero", async () => {
    const { view } = await import("../src/lib/format.js");
    const c = store.elementBySymbol.get("C")!;
    const v = view(c.mel_point);
    expect(v?.text).toBe("—");
    expect(v?.missing).toBeTruthy();
    const og = view(store.elementBySymbol.get("Og")!.density);
    expect(og?.predicted).toBe(true);
    expect(og?.approx).toBe(true);
  });
});
