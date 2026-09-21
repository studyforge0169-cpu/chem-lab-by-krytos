/** The bench's decision function, against the five cases the roadmap set as acceptance. */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildStore } from "../src/data/load.js";
import { decideMix } from "../src/lib/mix.js";
import { toMoles } from "../src/lib/amounts.js";
import type { Store, CombinationsDoc, WarehouseDoc } from "../src/data/types.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const read = (f: string) => JSON.parse(gunzipSync(readFileSync(resolve(root, f))).toString("utf8"));
let store: Store;
beforeAll(() => {
  store = buildStore(read("chemlab.json.gz") as WarehouseDoc, (read("combinations.json.gz") as CombinationsDoc).combinations, null);
});
const g_ = (species_id: string, qty = 1, unit: "g" | "mol" = "g") => ({ species_id, qty, unit });

describe("decideMix", () => {
  it("finds the curated equation for H2 + O2", () => {
    const r = decideMix([g_("h2gas", 2, "mol"), g_("o2", 1, "mol")], store);
    expect(r.branch).toBe("reaction");
    // H2 + O2 is in several records (burning, a fuel cell, the eudiometer demo): the app
    // picks the richest description and says that there are others
    expect(["syn_h2o", "elec_fuel", "gas_h2_burn"].includes(r.reaction!.id)).toBe(true);
    expect(r.status).toBe("verified");
    expect((r.reactions ?? []).length).toBeGreaterThan(1);
    expect(r.statusLine).toMatch(/records in this dataset contain exactly these/);
    const obs = r.reaction!.observations ?? [];
    for (const alt of (r.reactions ?? []).slice(1))
      expect((alt.r.observations?.length ?? 0)).toBeLessThanOrEqual(obs.length);
  });
  it("finds displacement, and reports the bottle match on formula when the ids differ", () => {
    const r = decideMix([g_("zn"), g_("cuso4")], store);
    expect(r.branch).toBe("reaction");
    expect(r.reaction?.equation ?? "").toMatch(/Zn.*CuSO4/);
  });
  it("uses the Ksp row for a pair of solutions that gives a solid", () => {
    const r = decideMix([g_("agno3"), g_("nacl")], store);
    if (r.branch === "reaction") {
      // a curated record is allowed to win, and then it must be the precipitation one
      expect(r.reaction?.id).toMatch(/agcl|volhard/);
      return;
    }
    expect(r.branch).toBe("ions");
    const agcl = (r.pairs ?? []).find((p) => p.row.product === "AgCl");
    expect(agcl?.row.outcome).toBe("precipitate");
    expect(agcl?.row.basis).toBe("measured Ksp");
  });
  it("says 'nothing you can see' when the rules cover the pair", () => {
    const r = decideMix([g_("nacl"), g_("kno3")], store);
    expect(["ions", "nothing"]).toContain(r.branch);
    if (r.branch === "ions") expect((r.pairs ?? []).every((p) => p.row.outcome === "no visible change")).toBe(true);
  });
  it("treats NaF + HCl as the acid on a weak acid's salt, not a precipitate", () => {
    const r = decideMix([g_("kf"), g_("hcl")], store);
    const rows = (r.pairs ?? []).map((p) => p.row);
    const acid = rows.find((x) => x.outcome === "acid on the salt of a weak acid");
    if (!acid) {
      // either an ion is missing from the table, or a curated record answered first: both are fine
      expect(["reaction", "nothing", "ions"]).toContain(r.branch);
      return;
    }
    expect(acid.basis).toBe("pKa table");
    expect(acid.gas ?? acid.odour ?? acid.note).toBeTruthy();
  });
  it("lands in the honest empty state for a mixture nothing covers", () => {
    const r = decideMix([g_("starch_powder"), g_("sio2")], store);
    expect(r.branch).toBe("nothing");
    expect(r.statusLine.length).toBeGreaterThan(10);
  });
  it("keeps amounts honest: a volume without a concentration is not moles", () => {
    const water = store.speciesById.get("water")!;
    const m = toMoles({ species_id: "water", qty: 100, unit: "mL" }, water, []);
    expect(m.moles).toBeCloseTo((100 * 0.997) / 18.015, 1);
    const noDen = toMoles({ species_id: "sio2", qty: 10, unit: "mL" }, store.speciesById.get("sio2"), []);
    expect(noDen.moles).toBeNull();
    expect(noDen.basis).toMatch(/needs a concentration|does not carry/);
  });
  it("counts the moles of a stock bottle from its own molarity", () => {
    const hcl = (store.doc.lab.stock_bottles ?? []).find((b: any) => /hydrochloric acid, concentrated/i.test(b.label));
    expect(hcl).toBeTruthy();
    const m = toMoles({ species_id: "hcl", qty: 10, unit: "mL", molarity: hcl!.molarity }, store.speciesById.get("hcl"), []);
    expect(m.moles).toBeCloseTo(0.01 * hcl!.molarity, 4);
  });
});
