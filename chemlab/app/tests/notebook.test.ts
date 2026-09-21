/** The notebook: capture, export, read back. What matters here is that a note keeps what the app
 *  said at the time - including a refusal - and that a file from last month still opens. */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { buildStore } from "../src/data/load.js";
import { decideMix } from "../src/lib/mix.js";
import { DEFAULT_CTX } from "../src/lib/guard.js";
import {
  captureNote,
  decodeNotes,
  encodeNotes,
  NOTEBOOK_APP,
  NOTEBOOK_VERSION,
  noteStale,
  noteToBench,
  summarizeNote,
  type Note,
} from "../src/lib/notebook.js";
import type { Store, WarehouseDoc, CombinationsDoc } from "../src/data/types.js";
import type { BenchItem } from "../src/state/app.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const read = (f: string) => JSON.parse(gunzipSync(readFileSync(resolve(root, f))).toString("utf8"));

let store: Store;

beforeAll(() => {
  store = buildStore(read("chemlab.json.gz") as WarehouseDoc, (read("combinations.json.gz") as CombinationsDoc).combinations, null, null);
});

const benchOf = (...items: [string, number, BenchItem["unit"]][]): BenchItem[] =>
  items.map(([species_id, qty, unit]) => ({ species_id, qty, unit }));

/** an ordinary pair the data has nothing to say about */
const plain = () => {
  const bench = benchOf(["nacl", 20, "g"], ["kno3", 10, "g"]);
  return { bench, mix: decideMix(bench, store, DEFAULT_CTX) };
};

describe("capturing what the bench said", () => {
  it("keeps the inputs, the verdict and the guard's findings", () => {
    const { bench, mix } = plain();
    const n = captureNote(bench, store, DEFAULT_CTX, { mix });
    expect(n.bench.length).toBe(2);
    expect(n.bench[0].name).toContain("Sodium chloride");
    expect(n.bench[0].qty).toBe(20);
    expect(n.verdict.branch).toBe(mix.branch);
    expect(n.verdict.status_line).toBe(mix.statusLine);
    expect(n.guard.level).toBe(mix.guard!.level);
    expect(n.guard.findings.length).toBe(mix.guard!.findings.length);
    for (const f of n.guard.findings) expect(f.from).toBeTruthy(); // every finding keeps its source
    expect(n.numbers.filter((x) => x.unit === "mol").length).toBe(2);
    expect(n.data.species).toBe(582);
    expect(n.data.reactions).toBe(424);
    expect(n.title).toContain(" + ");
    expect(n.id).toBeTruthy();
    expect(n.saved_utc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("records that nothing was decided, in the same words as the bench", () => {
    const { bench, mix } = plain();
    const n = captureNote(bench, store, DEFAULT_CTX, { mix });
    expect(n.verdict.reaction_id).toBeNull();
    expect(n.verdict.status).toBe(mix.status);
    expect(summarizeNote(n)).toContain("·");
  });

  it("does not smuggle back numbers the guard refused to show", () => {
    const bench = benchOf(["naclo", 50, "mL"], ["hcl", 5, "mL"]);
    const mix = decideMix(bench, store, DEFAULT_CTX);
    expect(mix.guard!.blocked).toBe(true);
    const n = captureNote(bench, store, DEFAULT_CTX, { mix });
    expect(n.guard.blocked).toBe(true);
    expect(n.guard.findings.some((f) => f.level === "block")).toBe(true);
    const hide = !!(mix.guard as any)?.reaction?.hide_scale;
    const mol = n.numbers.filter((x) => x.unit === "mol");
    if (hide) {
      expect(mol).toEqual([]);
      expect(n.numbers.some((x) => x.value === "withheld")).toBe(true);
    } else {
      // if the record ever stops hiding the scale, the note still must not carry a blocked bottle's amount
      expect(mol.every((x) => !/hypochlorite|chlorate/i.test(x.label)) || n.numbers.some((x) => x.value === "withheld")).toBe(true);
    }
  });

  it("a note saved without a verdict says so instead of leaving it blank", () => {
    const n = captureNote(benchOf(["nacl", 1, "g"]), store, DEFAULT_CTX);
    expect(n.verdict.status).toBe("none");
    expect(n.verdict.status_line).toContain("no mix was decided");
    expect(n.numbers).toEqual([]);
  });
});

describe("the file round trip", () => {
  it("writes and reads back the same note", () => {
    const { bench, mix } = plain();
    const n = captureNote(bench, store, DEFAULT_CTX, { mix });
    const text = encodeNotes([n], String(store.buildId ?? ""));
    const back = decodeNotes(text, String(store.buildId ?? ""));
    expect(back.problems).toEqual([]);
    expect(back.stale).toEqual([]);
    expect(back.notes.length).toBe(1);
    expect(back.notes[0]).toEqual(n);
    expect(back.header.app).toBe(NOTEBOOK_APP);
    expect(back.header.version).toBe(NOTEBOOK_VERSION);
    expect(back.header.build_id).toBe(String(store.buildId ?? ""));
  });

  it("a file on disk opens the same way as a string in memory", () => {
    const { bench, mix } = plain();
    const notes = [captureNote(bench, store, DEFAULT_CTX, { mix }), captureNote(benchOf(["water", 100, "mL"]), store, DEFAULT_CTX)];
    const path = join(tmpdir(), `chemlab-notebook-test-${process.pid}.json`);
    try {
      writeFileSync(path, encodeNotes(notes, String(store.buildId ?? "")));
      const back = decodeNotes(readFileSync(path, "utf8"), String(store.buildId ?? ""));
      expect(back.notes.length).toBe(2);
      expect(back.notes.map((x) => x.id)).toEqual(notes.map((x) => x.id));
      expect(back.notes[1].bench[0].name).toContain("Water");
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("an empty notebook exports as an empty notebook, not as nothing", () => {
    const back = decodeNotes(encodeNotes([], "abc"), "abc");
    expect(back.notes).toEqual([]);
    expect(back.problems).toEqual([]);
  });

  it("a note written against other data is flagged, not hidden", () => {
    const { bench, mix } = plain();
    const n = captureNote(bench, store, DEFAULT_CTX, { mix });
    expect(noteStale(n, String(store.buildId ?? ""))).toBe(false);
    expect(noteStale(n, "some-other-build")).toBe(true);
    const back = decodeNotes(encodeNotes([n], "old-build"), "new-build");
    expect(back.stale).toEqual([n.id]);
    expect(back.notes.length).toBe(1); // still readable, just marked
  });
});

describe("reading a file it does not like", () => {
  const bad = ["", "   ", "not json at all", "{}", "[]", "[1,2,3]", '{"notes":"nope"}', '{"notes":[null,7]}'];
  for (const t of bad) {
    it(`survives ${JSON.stringify(t).slice(0, 24)}`, () => {
      const back = decodeNotes(t, null);
      expect(Array.isArray(back.problems)).toBe(true);
      expect(back.notes.every((n: Note) => typeof n.id === "string" && Array.isArray(n.bench))).toBe(true);
      if (t.trim() && t.trim() !== "[]") expect(back.problems.length).toBeGreaterThan(0);
    });
  }

  it("takes an empty array as an empty notebook rather than as damage", () => {
    const back = decodeNotes("[]", null);
    expect(back.notes).toEqual([]);
    expect(back.problems).toEqual([]);
  });

  it("keeps what it understood and names what it dropped", () => {
    const { bench, mix } = plain();
    const good = captureNote(bench, store, DEFAULT_CTX, { mix });
    const text = JSON.stringify({ app: NOTEBOOK_APP, version: NOTEBOOK_VERSION, notes: [good, "a string", { title: "no bench" }] });
    const back = decodeNotes(text, null);
    expect(back.notes.length).toBe(2);
    expect(back.notes[0].id).toBe(good.id);
    expect(back.problems.some((p) => /not an object/.test(p))).toBe(true);
    expect(back.problems.some((p) => /no substances/.test(p))).toBe(true);
  });

  it("says when the file is somebody else's export", () => {
    const text = JSON.stringify({ app: "other-lab", notes: [] });
    const back = decodeNotes(text, null);
    expect(back.problems.some((p) => p.includes("other-lab"))).toBe(true);
  });

  it("tolerates a bare array, since that is what people keep in a text file", () => {
    const { bench, mix } = plain();
    const n = captureNote(bench, store, DEFAULT_CTX, { mix });
    const back = decodeNotes(JSON.stringify([n]), null);
    expect(back.notes.length).toBe(1);
    expect(back.header.app).toBeNull();
  });
});

describe("putting a note back on the bench", () => {
  it("carries the amounts and the context it was saved with", () => {
    const bench: BenchItem[] = [
      { species_id: "hcl", qty: 25, unit: "mL", molarity: 2 },
      { species_id: "naoh", qty: 1, unit: "g" },
    ];
    const n = captureNote(bench, store, { ...DEFAULT_CTX, hood: true }, { mix: decideMix(bench, store, { ...DEFAULT_CTX, hood: true }) });
    const back = decodeNotes(encodeNotes([n], "x"), "x").notes[0];
    const items = noteToBench(back);
    expect(items.length).toBe(2);
    expect(items[0]).toEqual({ species_id: "hcl", qty: 25, unit: "mL", molarity: 2 });
    expect(items.every((b) => store.speciesById.has(b.species_id))).toBe(true);
    expect(back.ctx.hood).toBe(true);
  });

  it("keeps a substance the shelf no longer has instead of dropping it quietly", () => {
    const n = captureNote(benchOf(["nacl", 1, "g"], ["not_a_species", 2, "g"]), store, DEFAULT_CTX);
    const items = noteToBench(n);
    expect(items.length).toBe(2);
    expect(items[1].species_id).toBe("not_a_species");
    expect(n.bench[1].name).toBe("not_a_species"); // the name falls back to the id, so the list still reads
    expect(store.speciesById.has("not_a_species")).toBe(false);
  });

  it("will not put more than four bottles on the bench, because that is what the bench holds", () => {
    const n = captureNote(
      benchOf(["nacl", 1, "g"], ["kno3", 1, "g"], ["water", 1, "mL"], ["sac", 1, "g"], ["glucose", 1, "g"]),
      store,
      DEFAULT_CTX,
    );
    expect(n.bench.length).toBe(5);
    expect(noteToBench(n).length).toBe(4);
  });
});
