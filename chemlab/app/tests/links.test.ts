/** Deep links: the format the home-screen shortcuts, the "copy a link" button and any future
 *  QR code all share. A hand-typed or half-broken link must land somewhere honest. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLink, parseBenchItem, parseLink, TABS, unresolvedBench } from "../src/lib/links.js";

describe("reading a link", () => {
  it("an empty one is nothing", () => {
    for (const s of ["", "?", "#", "&"]) {
      const l = parseLink(s);
      expect(l.tab).toBeNull();
      expect(l.bench).toEqual([]);
      expect(l.sheet).toBeNull();
      expect(l.problems).toEqual([]);
    }
  });

  it("picks the tab, and says so when the tab is not one of six", () => {
    expect(parseLink("?tab=safety").tab).toBe("safety");
    for (const t of TABS) expect(parseLink(`?tab=${t}`).tab).toBe(t);
    const bad = parseLink("?tab=shop");
    expect(bad.tab).toBeNull();
    expect(bad.problems[0]).toContain("shop");
    expect(bad.problems[0]).toContain("is not one of the 8 tabs");
  });

  it("reads bottles with their unit glued to the amount", () => {
    const l = parseLink("?bench=nacl:20g,hcl:5mL@2");
    expect(l.bench).toEqual([
      { species_id: "nacl", qty: 20, unit: "g" },
      { species_id: "hcl", qty: 5, unit: "mL", molarity: 2 },
    ]);
    expect(l.tab).toBe("bench"); // bottles named, so the tab follows them
    expect(l.problems).toEqual([]);
  });

  it("refuses a bottle it cannot place rather than guessing a unit", () => {
    for (const bit of ["nacl:20", "nacl:20kg", "nacl", "20g", "nacl:twenty:g", "na cl:20g"]) {
      const { item, problem } = parseBenchItem(bit);
      expect(item, bit).toBeUndefined();
      expect(problem, bit).toContain("substance:amount+unit");
    }
    expect(parseBenchItem("water:0.25L").item).toEqual({ species_id: "water", qty: 0.25, unit: "L" });
    expect(parseLink("?bench=nacl:20,nope:3").problems.length).toBe(2);
  });

  it("will not put a fifth bottle on a bench that holds four", () => {
    const l = parseLink("?bench=nacl:1g,kno3:1g,water:1L,hcl:1mL,sac:1g");
    expect(l.bench.length).toBe(4);
    expect(l.problems.join(" ")).toContain("four bottles");
  });

  it("opens one sheet, whichever kind it is", () => {
    expect(parseLink("?species=nacl").sheet).toEqual({ kind: "species", id: "nacl" });
    expect(parseLink("?element=Na").sheet).toEqual({ kind: "element", symbol: "Na" });
    expect(parseLink("?reaction=syn_h2o").sheet).toEqual({ kind: "reaction", id: "syn_h2o" });
    expect(parseLink("?pair=Na-Cl").sheet).toEqual({ kind: "combination", pair: "Na-Cl" });
    const two = parseLink("?species=nacl&element=Na");
    expect(two.sheet).toEqual({ kind: "species", id: "nacl" });
    expect(two.problems[0]).toContain("one sheet");
  });

  it("keeps a percent-encoded pair and survives a broken escape", () => {
    expect(parseLink("?bench=nacl%3A20g").bench[0]).toEqual({ species_id: "nacl", qty: 20, unit: "g" });
    expect(parseLink("?species=%ZZ").sheet).toEqual({ kind: "species", id: "%ZZ" });
    expect(parseLink("?pair=Na%2dCl").sheet).toEqual({ kind: "combination", pair: "Na-Cl" });
  });
});

describe("writing a link", () => {
  it("round-trips the things that matter", () => {
    const src = parseLink("?tab=bench&bench=nacl:20g,hcl:5mL@2&species=nacl");
    const out = parseLink(buildLink({ tab: src.tab, bench: src.bench, sheet: src.sheet }));
    expect(out.tab).toBe("bench");
    expect(out.bench).toEqual(src.bench);
    expect(out.sheet).toEqual(src.sheet);
    expect(out.problems).toEqual([]);
  });

  it("writes nothing when there is nothing to write", () => {
    expect(buildLink({})).toBe("");
    expect(buildLink({ tab: "table", bench: [] })).toBe("?tab=table");
  });

  it("the eight tabs in the bar are the eight tabs the parser knows", () => {
    expect(TABS).toEqual(["table", "shelf", "bench", "calc", "safety", "reactions", "work", "more"]);
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "App.tsx"), "utf8");
    const bar = [...src.matchAll(/\{ id: "([a-z]+)", label: "([^"]+)"/g)].map((m) => ({ id: m[1], label: m[2] }));
    expect(bar.length).toBe(TABS.length);
    for (const b of bar) {
      expect(TABS).toContain(b.id);
      expect(parseLink(`?tab=${b.id}`).tab).toBe(b.id);
    }
    // and every tab the bar knows is rendered by something in the same file
    for (const t of TABS) expect(src).toContain(`tab === "${t}" &&`);
    // the glyph has to sit *inside* the styled span, or it renders at 10.5 px next to the label
    expect(src).toMatch(/<span className="glyph" aria-hidden>\s*\{t\.glyph\}/);
  });

  it("the manifest's shortcuts are links this parser understands", () => {
    // a real check, not a tautology: the same function reads both, and the tabs are the app's six
    const here = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public", "manifest.webmanifest");
    const m = JSON.parse(readFileSync(here, "utf8"));
    expect(m.start_url).toBe("./");
    for (const sc of m.shortcuts) {
      const q = String(sc.url).slice(String(sc.url).indexOf("?"));
      const l = parseLink(q);
      expect(l.tab, sc.url).toBeTruthy();
    }
  });
});

describe("a link that names something the shelf does not have", () => {
  it("is reported, not dropped", () => {
    const { bench } = parseLink("?bench=nacl:20g,not_a_species:2g");
    const missing = unresolvedBench(bench, (id) => id === "nacl");
    expect(missing).toEqual(["not_a_species"]);
  });
});
