/** Prompt 10's acceptance criterion: "the guard's decision function is pure and tested for every
 *  blocked list plus a false-positive check (NaCl must pass)". So the lists are walked in full -
 *  not sampled - and a clean bench has to come back clean. */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildStore, type Loaded } from "../src/data/load.js";
import type { CombinationRec, SpeciesRec, WarehouseDoc } from "../src/data/types.js";
import {
  controlCensus,
  firstAidFrom,
  guardBench,
  guardReaction,
  guardSpecies,
  ruleApplicability,
  safetyLists,
  storageFor,
  wasteFor,
  type GuardCtx,
} from "../src/lib/guard.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const read = (f: string) => JSON.parse(gunzipSync(readFileSync(resolve(root, f))).toString("utf8"));

let store: Loaded["store"];
let si: any;
let lab: any;
beforeAll(() => {
  const doc = read("chemlab.json.gz") as WarehouseDoc;
  const comb = read("combinations.json.gz") as { combinations: CombinationRec[] };
  store = buildStore(doc, comb.combinations, null);
  si = (doc as any).safety_index;
  lab = (doc as any).lab;
});

const NO_HOOD: GuardCtx = { hood: false, supervised: false, room_flammable_mL: 0 };
const LAB: GuardCtx = { hood: true, supervised: true, room_flammable_mL: 0 };
const B = (species_id: string, qty = 1, unit: "g" | "mol" | "mL" | "L" = "g") => ({ species_id, qty, unit });
const rx = (id: string) => store.reactions.find((r) => r.id === id)!;
const sp = (id: string) => store.speciesById.get(id) as SpeciesRec;

describe("the guard, on the lists themselves", () => {
  it("refuses every reaction on the hard-stop list, in any room, supervised or not", () => {
    expect(si.reactions_hard_stopped.length).toBeGreaterThan(0);
    for (const id of si.reactions_hard_stopped) {
      for (const ctx of [NO_HOOD, LAB]) {
        const g = guardReaction(rx(id), store, ctx);
        expect(g.findings.some((f) => f.level === "block" && f.from.includes("reactions_hard_stopped"))).toBe(true);
        expect(g.suppress_route).toBe(true);
        expect(g.hide_scale).toBe(true);
      }
    }
  });

  it("warns about a restricted reaction and hands the decision over, without refusing it", () => {
    expect(si.reactions_restricted.length).toBeGreaterThan(0);
    for (const id of si.reactions_restricted) {
      const g = guardReaction(rx(id), store, NO_HOOD);
      const f = g.findings.find((x) => x.from.includes("reactions_restricted"));
      expect(f).toBeDefined();
      expect(f!.level).toBe("warn");
      expect(g.suppress_route).toBe(false); // unless the record itself says more
      const withSupervisor = guardReaction(rx(id), store, LAB).findings.find((x) => x.from.includes("reactions_restricted"))!;
      expect(withSupervisor.level).toBe("note");
      expect(withSupervisor.text).toContain("supervisor is here");
    }
  });

  it("says a hood is needed, and says so differently when there is one", () => {
    expect(si.reactions_needing_hood.length).toBeGreaterThan(0);
    for (const id of si.reactions_needing_hood) {
      const noHood = guardReaction(rx(id), store, NO_HOOD).findings.find((x) => x.from.includes("reactions_needing_hood"))!;
      const hood = guardReaction(rx(id), store, LAB).findings.find((x) => x.from.includes("reactions_needing_hood"))!;
      expect(noHood.level).toBe("warn");
      expect(hood.level).toBe("note");
      expect(noHood.text).not.toBe(hood.text);
    }
  });

  it("refuses a hazard-5 bottle only because there is no hood, which is the index's own rule", () => {
    expect(si.species_hazard5).toEqual(["p4"]);
    expect(sp("p4").hazard_score).toBe(5);
    expect(store.species.filter((s) => (s.hazard_score ?? 0) >= 5).map((s) => s.id)).toEqual(["p4"]);
    const refused = guardBench([B("p4", 0.2)], store, NO_HOOD);
    expect(refused.blocked).toBe(true);
    expect(refused.findings.find((f) => f.from.includes("species_hazard5"))!.level).toBe("block");
    const allowed = guardBench([B("p4", 0.2)], store, LAB);
    expect(allowed.blocked).toBe(false);
    expect(allowed.findings.find((f) => f.from.includes("species_hazard5"))!.level).toBe("warn");
    expect(allowed.findings.find((f) => f.from.includes("species_hazard5"))!.text).toContain("there is");
  });

  it("puts every danger-critical substance on the record it belongs to", () => {
    const list: string[] = si.species_ghs_danger_critical;
    expect(list.length).toBe(43);
    for (const id of list) {
      const g = guardSpecies(sp(id), store, NO_HOOD);
      const f = g.findings.find((x) => x.from.includes("species_ghs_danger_critical"));
      expect(f, id).toBeDefined();
      expect(f!.level).toBe("warn");
      expect(g.badge, id).toBe("warn");
    }
  });

  it("never lets a not-a-shelf-reagent record be weighed out", () => {
    const blocked = store.species.filter((s) => s.not_a_shelf_reagent);
    expect(blocked.length).toBe(37);
    for (const s of blocked) {
      const g = guardSpecies(s, store, LAB);
      const f = g.findings.find((x) => x.from === "species[].not_a_shelf_reagent")!;
      expect(f.level, s.id).toBe("block");
      // the reason is the data's sentence, not one the app wrote
      expect(f.text, s.id).toBe(s.shelf_block_reason ?? f.text);
      expect(g.badge, s.id).toBe("danger");
    }
    const v = guardBench([B("elem_tc", 1)], store, NO_HOOD);
    expect(v.blocked).toBe(true);
    expect(v.bottles[0].name).toContain("Technetium");
  });
});

describe("the guard, on a bench", () => {
  it("passes sodium chloride, and passes it with potassium nitrate too", () => {
    for (const bench of [[B("nacl", 5)], [B("nacl", 20), B("kno3", 10)], [B("nacl_aq", 50, "mL")]]) {
      const v = guardBench(bench, store, NO_HOOD);
      expect(v.blocked).toBe(false);
      expect(v.level).toBe("clear");
      expect(v.findings.filter((f) => f.level !== "note")).toEqual([]);
    }
  });

  it("fires the mixing rules it can see and names both bottles it matched", () => {
    const acid = guardBench([B("naclo", 50, "mL"), B("hcl", 5, "mL")], store, LAB);
    expect(acid.blocked).toBe(true);
    const f = acid.findings.find((x) => x.from === "lab.mixing_rules")!;
    expect(f.head).toContain("bleach");
    expect(f.text).toContain("chlorine");
    expect(f.action).toBe("refuse and explain");
    expect(f.via).toContain("hcl"); // the example in the rule's own parentheses, not "acid"
    const ammonia = guardBench([B("bleachhouse", 100, "mL"), B("nh4oh", 10, "mL")], store, LAB);
    expect(ammonia.findings.find((x) => x.from === "lab.mixing_rules")!.text).toContain("chloramines");
  });

  it("warns instead of refusing when the rule's own action is not a refusal", () => {
    const v = guardBench([B("naclo", 50, "mL"), B("h2o2", 10, "mL")], store, LAB);
    const f = v.findings.find((x) => x.from === "lab.mixing_rules")!;
    expect(f.level).toBe("warn");
    expect(f.action).toContain("vented");
    expect(v.blocked).toBe(false);
  });

  it("will not pair a bottle with itself", () => {
    const v = guardBench([B("naclo", 50, "mL")], store, LAB);
    expect(v.findings.some((f) => f.from === "lab.mixing_rules")).toBe(false);
    expect(v.checks.join(" ")).toContain("none of them match");
  });

  it("measures the room and the bench against the limits, with the limits' provenance", () => {
    const over = guardBench([B("acetone", 600, "mL")], store, NO_HOOD);
    const o = over.findings.find((f) => f.from.includes("max_flammable_in_room_mL"))!;
    expect(o.level).toBe("warn");
    expect(o.limit!.limit).toBe(500);
    expect(o.limit!.source).toBe(lab ? "curated (school-lab practice limits)" : "");
    expect(o.limit!.note).toContain("policy, not nature");
    const under = guardBench([B("acetone", 400, "mL")], store, NO_HOOD);
    const u = under.findings.find((f) => f.from.includes("max_flammable_in_room_mL"))!;
    expect(u.level).toBe("note");
    expect(u.limit!.over).toBe(false);
    // the room total counts even with an empty bench, because that is what the limit is about
    const room = guardBench([], store, { hood: false, supervised: false, room_flammable_mL: 900 });
    expect(room.findings.find((f) => f.from.includes("max_flammable_in_room_mL"))!.level).toBe("warn");
  });

  it("says which hazard statement made a bottle count as flammable", () => {
    const v = guardBench([B("nh4oh", 10, "mL")], store, NO_HOOD);
    const f = v.findings.find((x) => x.from.includes("max_flammable_in_room_mL"))!;
    expect(f.text).toMatch(/flammable pictogram|H2\d\d/);
  });

  it("applies the no-hood gram cap to hazard-3-and-worse, and not to salt", () => {
    const v = guardBench([B("p4", 0.2)], store, LAB); // hazard 5, but a hood is claimed
    // 40 mL of the concentrated bottle is 18 g of HCl against a cap of 5 g
    const noHoodCap = guardBench([B("hcl", 40, "mL")], store, NO_HOOD);
    const f = noHoodCap.findings.find((x) => x.from.includes("max_no_hood_gram"))!;
    expect(f.head).toContain("over the limit");
    expect(f.limit!.limit).toBe(5);
    // 40 mL of the 12.1 M bottle is 0.484 mol of HCl, which is 18 g of the solute: the mass the
    // limit is measured against is the substance, not the water it arrived in
    expect(f.limit!.measured).toContain("18 g");
    const clean = guardBench([B("nacl", 40)], store, NO_HOOD);
    const g2 = clean.findings.find((x) => x.from.includes("max_no_hood_gram"))!;
    expect(g2.level).toBe("note");
    expect(g2.limit!.checked).toBe(true);
    expect(g2.limit!.over).toBe(false);
    expect(v.findings.find((x) => x.from.includes("max_no_hood_gram"))!.limit!.checked).toBe(false);
  });

  it("knows an open bottle of concentrated acid by the label on the bottle", () => {
    const big = guardBench([B("hcl", 5, "mL")], store, LAB);
    const f = big.findings.find((x) => x.from.includes("max_open_conc_acid_mL"))!;
    expect(f.level).toBe("warn");
    expect(f.limit!.limit).toBe(2);
    const small = guardBench([B("hcl", 1, "mL")], store, LAB);
    expect(small.findings.find((x) => x.from.includes("max_open_conc_acid_mL"))!.level).toBe("note");
    // a dilute bottle of the same acid is not what the limit is about
    const dilute = guardBench([B("hclgas_water", 250, "mL")], store, LAB);
    expect(dilute.findings.find((x) => x.from.includes("max_open_conc_acid_mL"))!.level).toBe("note");
  });

  it("checks the water the acid goes into, and only when both are out", () => {
    const thin = guardBench([B("h2so4", 5, "mL"), B("water", 10, "mL")], store, LAB);
    const f = thin.findings.find((x) => x.from.includes("min_water_for_acid_dilution_ratio"))!;
    expect(f.level).toBe("warn");
    expect(f.head).toContain("below the minimum");
    expect(f.limit!.measured).toContain("2 volumes");
    const fat = guardBench([B("h2so4", 5, "mL"), B("water", 200, "mL")], store, LAB);
    expect(fat.findings.find((x) => x.from.includes("min_water_for_acid_dilution_ratio"))!.level).toBe("note");
    // with only water out, the ratio is not a question the app asks: it is recorded as un-checked
    const nocid = guardBench([B("water", 200, "mL")], store, LAB);
    expect(nocid.findings.some((x) => x.from.includes("min_water_for_acid_dilution_ratio"))).toBe(false);
    const unplayed = nocid.limits.find((x) => x.key === "min_water_for_acid_dilution_ratio")!;
    expect(unplayed.checked).toBe(false);
    expect(unplayed.measured).toContain("only bites");
  });

  it("attaches the reaction's own verdict to the mix, so the bench has one source of truth", () => {
    const v = guardBench([B("naclo", 50, "mL"), B("hcl", 5, "mL")], store, NO_HOOD, "app_bleach_acid_warning");
    expect(v.reaction!.id).toBe("app_bleach_acid_warning");
    expect(v.reaction!.suppress_route).toBe(true);
    expect(v.blocked).toBe(true);
    const plain = guardBench([B("h2gas", 1, "g"), B("o2", 8, "g")], store, LAB, "syn_h2o");
    expect(plain.blocked).toBe(false);
    expect(plain.reaction!.suppress_route).toBe(false);
    expect(plain.reaction!.hide_scale).toBe(false);
  });
});

describe("the guard, on what the data asks for", () => {
  it("implements every control token in the reaction set, or admits it does not", () => {
    const census = controlCensus(store);
    expect(census.length).toBeGreaterThan(10);
    const unknown = census.filter((c) => !c.known);
    expect(unknown.map((u) => u.token)).toEqual([]);
    // and the counts add up to the records that carry controls
    const withControls = store.reactions.filter((r) => ((r as any).safety?.controls ?? []).length).length;
    expect(census.reduce((a, c) => a + c.count, 0)).toBeGreaterThanOrEqual(withControls);
  });

  it("reports which mixing rules it cannot enforce, with a reason for each", () => {
    const r = ruleApplicability(store);
    expect(r.total).toBe(lab.mixing_rules.length);
    expect(r.actionable).toBeGreaterThan(10);
    expect(r.rows.every((x) => x.why.length > 10)).toBe(true);
    const unenforceable = r.rows.filter((x) => !x.actionable);
    expect(unenforceable.some((x) => /hot plate|skin|bench/.test(x.with + x.and))).toBe(true);
  });

  it("quotes the index's rule and every list in full", () => {
    const lists = safetyLists(store);
    expect(lists.length).toBe(5);
    expect(lists.map((l) => l.ids.length).join(",")).toBe(
      [
        si.reactions_hard_stopped.length,
        si.reactions_restricted.length,
        si.reactions_needing_hood.length,
        si.species_hazard5.length,
        si.species_ghs_danger_critical.length,
      ].join(","),
    );
    expect(lists.every((l) => l.what.length > 8)).toBe(true);
  });

  it("prints a limit with no number as no number, never as zero", () => {
    const lim: any = (store.doc.tables as any).safety_limits;
    const nullKeys = Object.keys(lim).filter((k) => lim[k] && lim[k].value === null);
    expect(nullKeys.length).toBeGreaterThan(0);
    const v = guardBench([B("nacl", 1)], store, NO_HOOD);
    const shown = [
      ...v.findings.flatMap((f) => [f.head, f.text, f.action ?? "", f.via ?? "", f.from]),
      ...v.limits.flatMap((l) => [l.measured, l.source]),
      ...v.checks,
    ].join(" | ");
    for (const bad of ["null", "undefined", "NaN", "[object Object]", "Infinity"]) expect(shown, bad).not.toContain(bad);
  });
});

describe("the guard, on what to do about it", () => {
  it("prefers an emergency entry that names the substance", () => {
    const em = lab.emergency;
    const phenol = firstAidFrom(em, sp("phenol"));
    expect(phenol.some((a) => a.key === "phenol on the skin")).toBe(true);
    expect(phenol.find((a) => a.key === "phenol on the skin")!.why).toContain("names your substance");
    expect(firstAidFrom(em, sp("br2")).some((a) => a.key === "bromine on the skin")).toBe(true);
    expect(firstAidFrom(em, sp("hg")).some((a) => a.key === "mercury spill")).toBe(true);
    // table salt carries H318 on its shipped label, so the eye entry is earned, not invented;
    // a bottle with no hazard statement at all gets nothing
    expect(firstAidFrom(em, sp("nacl")).map((a) => a.key)).toContain("acid or alkali in the eye");
    expect(firstAidFrom(em, sp("water"))).toEqual([]);
  });

  it("sorts the waste by the classes' own item lists and titles", () => {
    const w = wasteFor(sp("ccl4"), store);
    expect(w.some((x) => x.cls === "halogenated organic")).toBe(true);
    expect(w.find((x) => x.cls === "halogenated organic")!.via).toContain("the class lists");
    const byEl = wasteFor(sp("pbno3_2"), store);
    expect(byEl.some((x) => x.cls.startsWith("heavy metal"))).toBe(true);
    expect(byEl.find((x) => x.cls.startsWith("heavy metal"))!.via).toContain("element");
    expect(wasteFor(sp("nacl"), store).some((x) => x.cls.startsWith("acids and alkalis"))).toBe(false);
  });

  it("puts the bottle in a cabinet the rule's own text supports", () => {
    expect(storageFor(sp("acetone"), store).some((x) => x.rule === "flammables cabinet")).toBe(true);
    expect(storageFor(sp("naoh"), store).some((x) => x.rule === "base cabinet")).toBe(true);
    expect(storageFor(sp("agno3"), store).some((x) => x.rule.startsWith("light-sensitive"))).toBe(true);
    expect(storageFor(sp("nacl"), store)).toEqual([]);
  });
});
