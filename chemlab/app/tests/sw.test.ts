/** The worker, run for real. `dist/sw.js` is a script the browser executes on its own thread, so it
 *  is easy to ship a version that has never actually been exercised — the usual failure being silent
 *  (the page just keeps needing the network). This loads the shipped file into a fake global scope
 *  and drives its install/fetch/message handlers against fake caches, then checks the messages it
 *  posts are the ones `src/lib/sw.ts` knows how to fold into the UI. */
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyShipMessage, INITIAL_SHIP, newDataAvailable, shipPill, shipSummary } from "../src/lib/sw.js";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const origin = "https://lab.test";

class Req {
  url: string;
  method: string;
  mode: string;
  cache: string;
  constructor(url: string, init: { method?: string; mode?: string; cache?: string } = {}) {
    const raw = typeof url === "string" ? url : (url as any).url;
    // a browser resolves "./x" against the worker scope; so must this fake, or the cache keys
    // would not line up with the request keys and every test below would be checking nothing
    this.url = new URL(raw, `${origin}/`).href;
    this.method = init.method ?? "GET";
    this.mode = init.mode ?? "cors";
    this.cache = init.cache ?? "default";
  }
}
class Res {
  body: string;
  ok: boolean;
  status: number;
  errored = false;
  headers = { get: () => null };
  constructor(body = "", init: { status?: number } = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
  }
  static error() {
    const r = new Res("", { status: 0 });
    r.errored = true;
    r.ok = false;
    return r;
  }
  text() {
    return Promise.resolve(this.body);
  }
  json() {
    return Promise.resolve(JSON.parse(this.body));
  }
  clone() {
    const c = new Res(this.body, { status: this.status });
    c.errored = this.errored;
    return c;
  }
}

/** a fresh worker, with the network and the cache under our control */
function boot(opts: { files?: Record<string, string>; cached?: Record<string, Record<string, string>>; failFetch?: (url: string) => boolean } = {}) {
  const path = existsSync(join(app, "dist", "sw.js")) ? join(app, "dist", "sw.js") : join(app, "public", "sw.js");
  const code = readFileSync(path, "utf8");

  const stores = new Map<string, Map<string, Res>>();
  // seed the caches the test named, before anything looks in them: a browser keeps a cache it was
  // once opened, and the worker under test may read one it never opens itself
  for (const [name, entries] of Object.entries(opts.cached ?? {})) {
    const m = new Map<string, Res>();
    for (const [u, body] of Object.entries(entries)) m.set(u, new Res(body));
    stores.set(name, m);
  }
  const cacheFor = (n: string) => {
    if (!stores.has(n)) {
      const m = new Map<string, Res>();
      for (const [u, body] of Object.entries(opts.cached?.[n] ?? {})) m.set(u, new Res(body));
      stores.set(n, m);
    }
    return stores.get(n)!;
  };
  const caches = {
    open: async (n: string) => {
      const m = cacheFor(n);
      return {
        add: async (req: Req | string) => {
          const u = new Req(req as any).url;
          m.set(u, await net(u));
        },
        put: async (req: Req | string, res: Res) => m.set(new Req(req as any).url, res),
        keys: async () => [...m.keys()].map((u) => ({ url: u })),
      };
    },
    match: async (req: Req | string) => {
      const u = new Req(req as any).url;
      for (const m of stores.values()) if (m.has(u)) return m.get(u)!.clone();
      return null;
    },
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
  };

  const calls: string[] = [];
  const net = async (req: Req | string): Promise<Res> => {
    const u = new Req(req as any).url;
    calls.push(u);
    if (opts.failFetch?.(u)) throw new Error("simulated: no network");
    const body = opts.files?.[u];
    if (body === undefined) return Res.error();
    return new Res(body);
  };

  const posted: any[] = [];
  const client = { postMessage: (m: any) => posted.push(m) };
  const listeners: Record<string, ((e: any) => void)[]> = {};
  const self: any = {
    location: { origin, href: `${origin}/sw.js` },
    addEventListener: (t: string, fn: (e: any) => void) => ((listeners[t] ??= []).push(fn)),
    clients: { matchAll: async () => [client], claim: async () => {} },
    skipWaiting: () => {
      self.__skipped = true;
    },
    // the worker itself answers a message when there is no client to answer
    postMessage: (m: any) => posted.push(m),
  };
  const setTimeoutShim = (fn: () => void) => {
    void fn;
    return 0;
  };
  // the shipped file, in a scope we own: same code the browser would run
  const run = new Function("self", "caches", "fetch", "Request", "Response", "URL", "console", "setTimeout", "Promise", "JSON", code);
  run(self, caches, (u: any, i: any) => net(new Req(typeof u === "string" ? u : u.url, i)), Req, Res, URL, { log: () => {}, warn: () => {}, error: () => {} }, setTimeoutShim, Promise, JSON);

  const wait = async () => {
    while (pending.length) await pending.shift();
  };
  const pending: Promise<any>[] = [];
  const fire = async (type: string, event: any) => {
    event.waitUntil = (p: Promise<any>) => pending.push(p);
    for (const fn of listeners[type] ?? []) fn(event);
    await wait();
  };
  const request = (url: string, mode = "cors") => {
    const out: { res?: Res } = {};
    const req = new Req(url, { mode });
    const e = {
      request: req,
      respondWith: (p: Promise<Res> | Res) => {
        // the spec lets a worker hand back a plain Response; the tests must not care which it did
        pending.push(Promise.resolve(p).then((r) => (out.res = r)));
      },
      waitUntil: (p: Promise<any>) => pending.push(p),
      source: client,
      data: null as any,
    };
    return { req, e, out };
  };
  const fetchVia = async (url: string, mode = "cors") => {
    const { e, out } = request(url, mode);
    await fire("fetch", e);
    return out.res!;
  };
  return {
    self,
    caches,
    calls,
    posted,
    stores,
    fire,
    fetchVia,
    install: () => fire("install", { waitUntil: () => {} }).then(wait),
    client,
  };
}

const abs = (u: string) => new URL(u, `${origin}/`).href;

describe("installing", () => {
  it("caches the shell and the data, and does not fail if one file is missing", async () => {
    const w = boot({
      files: { [abs("./index.html")]: "<html>", [abs("./data/chemlab.json.gz")]: "gz" },
    });
    await w.self && (await w.stores); // no-op: keeps the shape of the harness obvious
    const install = w.fire("install", { waitUntil: (p: Promise<any>) => p });
    await install;
    const shell = [...w.stores.values()][0];
    expect(shell!.size).toBeGreaterThan(0);
    // every url in the worker's own PRECACHE list was asked for
    const list = JSON.parse(/const PRECACHE = (\[[^\]]*\])/.exec(readFileSync(join(app, "public", "sw.js"), "utf8"))![1]) as string[];
    for (const u of list) expect([...shell.keys()], `install did not fetch ${u}`).toContain(abs(u));
    expect(w.posted).toEqual([]);
  });

  it("the activate pass drops caches from older builds", async () => {
    const w = boot({ files: {}, cached: { "chemlab-shell-oldbuild": { [abs("./index.html")]: "<html>" } } });
    await w.fire("activate", {});
    expect([...w.stores.keys()].some((k) => k.includes("oldbuild"))).toBe(false);
  });
});

describe("serving", () => {
  it("the data files come from the cache and never from the network twice", async () => {
    const w = boot({ cached: { "chemlab-data": { [abs("./data/chemlab.json.gz")]: "the warehouse" } }, files: {} });
    const res = await w.fetchVia(abs("./data/chemlab.json.gz"));
    expect(await res.text()).toBe("the warehouse");
    expect(w.calls).toEqual([]); // nothing left the page: that is the whole point of the rule
  });

  it("a data file that is not cached is fetched once, then kept", async () => {
    const w = boot({ files: { [abs("./data/combinations.json.gz")]: "pairs" } });
    expect(await (await w.fetchVia(abs("./data/combinations.json.gz"))).text()).toBe("pairs");
    expect(w.calls.length).toBe(1);
    expect(await (await w.fetchVia(abs("./data/combinations.json.gz"))).text()).toBe("pairs");
    expect(w.calls.length).toBe(1);
  });

  it("refuses to fetch from another origin, whatever the page asks for", async () => {
    const w = boot({ files: { "https://fonts.test/f.css": "body{}" } });
    const res = await w.fetchVia("https://fonts.test/f.css");
    expect(res.errored).toBe(true);
    expect(w.calls).toEqual([]);
  });

  it("a cold start with no network still opens the app", async () => {
    const w = boot({
      files: {},
      cached: { "chemlab-shell-dev": { [abs("./index.html")]: "<html>the app</html>" } },
      failFetch: () => true,
    });
    const res = await w.fetchVia(abs("./anything/at/all"), "navigate");
    expect(res.errored).toBe(false);
    expect(await res.text()).toContain("the app");
  });
});

describe("the update path", () => {
  const oldBuild = JSON.stringify({ build_id: "aaa", generated: "yesterday", files: {} });
  const newBuild = JSON.stringify({ build_id: "bbb", generated: "today", files: {} });

  it("a new build id in the manifest pulls the data down and tells the page", async () => {
    const w = boot({
      files: {
        [abs("./data/manifest.json")]: newBuild,
        [abs("./data/chemlab.json.gz")]: "new warehouse",
        [abs("./data/combinations.json.gz")]: "new pairs",
      },
      cached: {
        "chemlab-data": { [abs("./data/manifest.json")]: oldBuild, [abs("./data/chemlab.json.gz")]: "old warehouse" },
      },
    });
    const res = await w.fetchVia(abs("./data/manifest.json"));
    expect(await res.json()).toMatchObject({ build_id: "bbb" }); // the page gets the fresh one
    const msg = w.posted.find((m) => m.type === "chemlab:new-data");
    expect(msg).toBeTruthy();
    expect(msg.build_id).toBe("bbb");
    expect(w.calls).toContain(abs("./data/combinations.json.gz")); // both data files, in the background

    // and the client's pure fold turns that message into the thing the header shows
    const state = applyShipMessage({ ...INITIAL_SHIP, controlling: true, build: "aaa" }, msg);
    expect(state.pending).toBe("bbb");
    expect(newDataAvailable(state, "aaa")).toBe(true);
    expect(shipPill(state, "aaa")).toContain("new data available");
    expect(shipPill(state, "bbb")).toBe(null); // once you are running it, there is nothing to say
    expect(shipSummary(state, "aaa").headline).toContain("a newer build is ready");
  });

  it("an unreachable manifest keeps the cached copy and says so", async () => {
    const w = boot({ files: {}, cached: { "chemlab-data": { [abs("./data/manifest.json")]: oldBuild } }, failFetch: () => true });
    const res = await w.fetchVia(abs("./data/manifest.json"));
    expect(await res.json()).toMatchObject({ build_id: "aaa" });
    expect(w.posted.some((m) => m.type === "chemlab:offline")).toBe(true);
    const state = applyShipMessage({ ...INITIAL_SHIP, controlling: true }, w.posted.find((m) => m.type === "chemlab:offline"));
    expect(state.note).toContain("cached copy");
  });

  it("a manifest that has not changed is not an update", async () => {
    const w = boot({
      files: { [abs("./data/manifest.json")]: oldBuild },
      cached: { "chemlab-data": { [abs("./data/manifest.json")]: oldBuild } },
    });
    await w.fetchVia(abs("./data/manifest.json"));
    expect(w.posted.some((m) => m.type === "chemlab:new-data")).toBe(false);
    expect(w.posted.some((m) => m.type === "chemlab:current")).toBe(true);
    expect(w.calls.filter((u) => u.includes("chemlab.json.gz"))).toEqual([]); // no pointless 1 MB re-fetch
    const state = applyShipMessage({ ...INITIAL_SHIP, controlling: true, build: "aaa" }, w.posted.find((m) => m.type === "chemlab:current"));
    expect(newDataAvailable(state, "aaa")).toBe(false);
  });
});

describe("asked what it has", () => {
  it("answers with the state the Data tab prints", async () => {
    const gz = gunzipSync(readFileSync(join(app, "public", "data", "combinations.json.gz"))).length;
    expect(gz).toBeGreaterThan(1000); // a real file, so the counts below mean something
    const w = boot({ cached: { "chemlab-data": { [abs("./data/chemlab.json.gz")]: "w", [abs("./data/manifest.json")]: JSON.stringify({ build_id: "zzz" }) } } });
    await w.fire("message", { data: { type: "chemlab:check" }, source: w.client, waitUntil: (p: Promise<any>) => p });
    const state = w.posted.find((m) => m.type === "chemlab:state");
    expect(state).toBeTruthy();
    expect(state.data.length).toBe(2);
    expect(state.data.find((d: any) => d.url.includes("chemlab")).hit).toBe(true);
    expect(state.data.find((d: any) => d.url.includes("combinations")).hit).toBe(false);
    expect(state.manifest_cached).toBe(true);
    expect(state.build).toBe("zzz");
    const folded = applyShipMessage(INITIAL_SHIP, state);
    expect(folded.controlling).toBe(true);
    expect(folded.note).toContain("not all cached yet");
    expect(shipPill(folded, "zzz")).toBe("1/2 data files cached");
  });

  it("re-fetches the data on request and reports whether it worked", async () => {
    const w = boot({ files: { [abs("./data/chemlab.json.gz")]: "fresh", [abs("./data/combinations.json.gz")]: "fresh pairs", [abs("./data/manifest.json")]: "{}" } });
    await w.fire("message", { data: { type: "chemlab:refresh-data" }, source: w.client, waitUntil: (p: Promise<any>) => p });
    expect(w.posted.some((m) => m.type === "chemlab:data-refreshed" && m.ok)).toBe(true);
    const state = applyShipMessage(INITIAL_SHIP, w.posted.find((m) => m.type === "chemlab:data-refreshed"));
    expect(state.note).toContain("re-fetched");

    const off = boot({ files: {}, failFetch: () => true });
    await off.fire("message", { data: { type: "chemlab:refresh-data" }, source: off.client, waitUntil: (p: Promise<any>) => p });
    const bad = off.posted.find((m) => m.type === "chemlab:data-refreshed");
    expect(bad.ok).toBe(false);
    expect(applyShipMessage(INITIAL_SHIP, bad).note).toContain("re-fetch failed");
  });

  it("ignores a message it does not own", () => {
    for (const junk of [null, undefined, 7, "chemlab:check", {}, { type: "other" }, { type: "chemlab:state" }]) {
      const s = applyShipMessage(INITIAL_SHIP, junk);
      expect(typeof s.controlling).toBe("boolean");
      expect(Array.isArray(s.data)).toBe(true);
    }
  });
});
