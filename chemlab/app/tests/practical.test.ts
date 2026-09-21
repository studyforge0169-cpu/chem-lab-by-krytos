/** Prompt 14: the practical-work layer. The two things that matter are that nothing the data asks
 *  for is quietly dropped, and that no procedure is offered where the guard says no. */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildStore } from "../src/data/load.js";
import {
  anionScheme,
  apparatusList,
  apparatusRef,
  cationScheme,
  curriculum,
  kits,
  organicTests,
  paperTests,
  practicalGaps,
  speciesInText,
  techniques,
  troubleshooting,
} from "../src/lib/practical.js";
import { DEFAULT_CTX, guardReaction } from "../src/lib/guard.js";
import type { CombinationsDoc, Store, WarehouseDoc } from "../src/data/types.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const read = (f: string) => JSON.parse(gunzipSync(readFileSync(resolve(root, f))).toString("utf8"));

let store: Store;
let doc: WarehouseDoc;

beforeAll(() => {
  doc = read("chemlab.json.gz") as WarehouseDoc;
  store = buildStore(doc, (read("combinations.json.gz") as CombinationsDoc).combinations, null, null);
});

describe("nothing the data asks for is dropped", () => {
  it("every kit id is either a register row or a named gap", () => {
    const raw = (doc.lab as any).kits as Record<string, string[]>;
    const rows = kits(store);
    expect(rows.length).toBe(Object.keys(raw).length);
    for (const k of rows) {
      const named = raw[k.id].length;
      const unique = new Set(raw[k.id].map((x) => String(x).toLowerCase())).size;
      expect(k.items.length + k.unregistered.length).toBe(unique);
      expect(k.items.length + k.unregistered.length).toBeLessThanOrEqual(named);
    }
    // 92 references, all of them answered by a register row now that the accessories are in it
    const all = Object.values(raw).flatMap((x) => x as string[]);
    expect(all.length).toBe(92);
    const expected = Object.values(raw).reduce((a: number, ids: string[]) => a + new Set(ids.map((x) => String(x).toLowerCase())).size, 0);
    expect(rows.reduce((a, k) => a + k.items.length + k.unregistered.length, 0)).toBe(expected);
    expect(rows.reduce((a, k) => a + k.unregistered.length, 0)).toBe(0);
    // the safety kit, which is the one that used to be almost entirely unanswerable
    const safety = rows.find((k) => k.id === "first-aid-safety")!;
    expect(safety.items.length).toBeGreaterThan(3);
    for (const x of ["tongs", "ring", "stand", "extinguisher", "first_aid_box", "eye_wash", "waste_containers"])
      expect(safety.items.concat(rows.flatMap((k) => k.items)).some((i) => i.id === x)).toBe(true);
    for (const x of ["burette_50", "pipette_25", "volumetric_250", "conical_250"]) expect(new Set(rows.flatMap((k) => k.unregistered))).not.toContain(x);
    // and none of the accessories pretends to be measured
    for (const k of rows) for (const i of k.items) if (i.kind === "safety") expect(i.tolerance).toBeNull();
  });

  it("a technique naming glassware as a sentence is read once, in its own words", () => {
    const t = techniques(store);
    expect(t.length).toBe(15);
    const sub = t.find((x) => x.id === "sublimation")!;
    // the sentence is split on '+', each part looked up, and only what the register has becomes an id
    expect(sub.apparatus.map((a) => a.raw)).toEqual(["inverted funnel"]);
    expect(sub.unregistered).toEqual([]);
    expect(sub.wrote_ids).toBe(false);
    expect(sub.prose.join(" + ")).toContain("porcelain dish");
    // a technique that named ids has no prose line
    const fil = t.find((x) => x.id === "filtration")!;
    expect(fil.wrote_ids).toBe(true);
    expect(fil.prose).toEqual([]);
    expect(fil.apparatus.map((a) => a.id)).toContain("filter-paper");
    // a list of ids resolves normally: the technique's own three, all registered
    expect(fil.apparatus.map((a) => a.id)).toEqual(["funnel_glass", "filter-paper", "conical_250"]);
    expect(fil.apparatus.find((a) => a.id === "funnel_glass")?.tolerance).toBeNull(); // a plain funnel measures nothing
    expect(fil.apparatus.find((a) => a.id === "conical_250")?.tolerance).toContain("±");
    // and every technique's steps come from the data, none from here
    const withSteps = t.filter((x) => x.steps.length).length;
    expect(withSteps).toBe(((doc.tables as any).techniques as any[]).filter((x) => Array.isArray(x.steps) && x.steps.length).length);
    for (const x of t.filter((y) => !y.steps.length)) expect(x.steps).toEqual([]);
  });

  it("the register's tolerance is quoted with the number the register carries", () => {
    const b = apparatusRef(store, "burette_50");
    expect(b.id).toBe("burette_50");
    expect(b.label.toLowerCase()).toContain("burette");
    expect(b.tolerance).toContain("±");
    expect(b.tolerance).toMatch(/0\.0[0-9]/);
    const p = apparatusRef(store, "pipette_25");
    expect(p.capacity).toContain("25");
    expect(p.from).toBeTruthy();
    const ghost = apparatusRef(store, "a piece of string");
    expect(ghost.id).toBeNull();
    expect(ghost.raw).toBe("a piece of string");
    expect(ghost.tolerance).toBeNull();
    expect(apparatusList(store, ["burette_50", "a piece of string"]).unregistered).toEqual(["a piece of string"]);
  });

  it("the syllabus names 62 reactions and all 62 exist", () => {
    const groups = curriculum(store);
    expect(groups.map((g) => g.experiments.length)).toEqual([11, 17, 4, 11]);
    const rx = groups.flatMap((g) => g.experiments.flatMap((e) => e.reactions));
    expect(rx.length).toBe(62);
    expect(rx.filter((r) => r.missing)).toEqual([]);
    for (const r of rx) expect(store.reactionById.has(r.id)).toBe(true);
    expect(practicalGaps(store).filter((g) => g.kind === "reaction")).toEqual([]);
  });

  it("every gap it reports says where the request came from", () => {
    const gaps = practicalGaps(store);
    // the register now answers everything the kits, techniques and syllabus ask for by id; the only
    // entries left in words are prose, which is not a gap in a register of ids
    expect(gaps).toEqual([]);
    const prose = techniques(store).flatMap((t) => t.prose);
    expect(prose.join(" ")).toContain("porcelain dish");
    expect(prose.join(" ")).toContain("cotton plug");
    for (const grp of curriculum(store)) for (const e of grp.experiments) expect(e.unregistered).toEqual([]);
  });
});

describe("the schemes are the data's, resolved only as far as the data allows", () => {
  it("seven cation groups, in the data's order, with the reagents it names", () => {
    const c = cationScheme(store);
    expect(c.length).toBe(7);
    expect(c[0].group).toContain("ammonium");
    expect(c[0].why).toContain("FIRST");
    expect(c[0].confirm.length).toBe(3);
    expect(c[1].precipitate.map((p) => p.formula)).toEqual(["PbCl2", "Hg2Cl2", "AgCl"]);
    expect(c[1].precipitate.every((p) => !!p.id)).toBe(true);
    for (const step of c) {
      for (const sp of step.reagent_species) expect(store.speciesById.has(sp.id)).toBe(true);
      expect(step.reagent.length).toBeGreaterThan(3);
    }
    const resolved = c.filter((x) => x.reagent_species.length).length;
    expect(resolved).toBe(6);
  });

  it("a group reagent resolves to a bottle the shelf carries, and says which", () => {
    const c = cationScheme(store);
    const groupI = c[1];
    expect(groupI.reagent_species[0].says).toBe("HCl");
    expect(groupI.reagent_species[0].id).toBe("hcl");
    // the data's own bottle is the concentrated one, and the text asked for dilute: the app says so
    expect(groupI.reagent_species[0].mismatch).toContain("dilute");
    expect(groupI.reagent_species[0].mismatch).toContain("will not pretend");
    expect(groupI.reagent_species[0].alternatives.length).toBeGreaterThan(0);
    // and a sentence about fumes resolves to the gas, not the solution
    const gas = speciesInText(store, "white fumes with HCl");
    expect(gas[0].id).toContain("gas");
  });

  it("it will not invent a reagent from a word that is not a formula", () => {
    expect(speciesInText(store, "a spatula of unobtainium, warm")).toEqual([]);
    expect(speciesInText(store, "Nessler's reagent on a spot").map((x) => x.id)).toEqual([]);
    expect(speciesInText(store, "").length).toBe(0);
  });

  it("the anion, organic and paper layers come through whole", () => {
    const a = anionScheme(store);
    expect(a.length).toBe(3);
    expect(a[0].tests.length).toBeGreaterThan(4);
    expect(a[0].tests[0].observation).toContain("limewater");
    const o = organicTests(store);
    expect(o.length).toBe(((doc.lab as any).organic_tests as any[]).length);
    expect(o.filter((x) => x.positive).length).toBe(o.length);
    expect(o.some((x) => x.caution?.includes("interferences"))).toBe(true);
    expect(o.filter((x) => x.strength_note).length).toBeGreaterThan(0);
    const p = paperTests(store);
    expect(p.length).toBe(10);
    expect(p.some((x) => x.note.includes("does NOT mean chlorine"))).toBe(true);
  });

  it("troubleshooting is joined to techniques by the words, and labelled as such", () => {
    const t = troubleshooting(store);
    expect(t.length).toBe(10);
    expect(t[0].causes.length).toBe(4);
    expect(t[0].techniques).toContain("Titration");
    for (const x of t) expect(x.fix.length).toBeGreaterThan(20);
  });
});

describe("no procedure where the guard says no", () => {
  it("a blocked reaction offers bottles to nobody", () => {
    // the shipped syllabus contains no blocked experiment, so the rule is proved on a copy of the
    // doc with one reaction flipped: the same code path, an honest fixture
    const blocked = (doc.reactions ?? []).find((r) => (r.safety as any)?.blocked) ?? null;
    expect(blocked).toBeTruthy();
    const mut: any = JSON.parse(JSON.stringify(doc));
    const first = mut.lab.curriculum["CBSE Class 11"];
    const key = Object.keys(first)[0];
    first[key] = { react: [blocked!.id], app: ["burette_50"], time: 15 };
    const s2 = buildStore(mut as WarehouseDoc, [], null, null);
    const exp = curriculum(s2)[0].experiments.find((e) => e.name === key)!;
    expect(exp.reactions[0].route).toBe(false);
    expect((exp.reactions[0].why_no_route ?? "").toLowerCase()).toContain("block");
    expect(exp.withheld).toBeGreaterThan(0);
    for (const sp of exp.species) expect((sp.blocked ?? "").length).toBeGreaterThan(4);
    expect(guardReaction(s2.reactionById.get(blocked!.id) as any, s2, DEFAULT_CTX).suppress_route).toBe(true);
  });

  it("the technique's own reaction links mark what may not be run", () => {
    const mut: any = JSON.parse(JSON.stringify(doc));
    const rx = mut.reactions.find((r: any) => r.record_type === "equation");
    rx.categories = [...(rx.categories ?? []), "filtration"];
    rx.safety = { ...(rx.safety ?? {}), blocked: true };
    const s2 = buildStore(mut as WarehouseDoc, [], null, null);
    const fil = techniques(s2).find((t) => t.id === "filtration")!;
    expect(fil.reactions.map((r) => r.id)).toContain(rx.id);
    expect(fil.blocked).toContain(rx.name);
  });
});
