/** The client half of the service worker. Registration is a browser thing, so it lives behind a
 *  guard and a production check; what the UI shows is derived from `describeShip`, which is a pure
 *  function over the messages, because that is the part worth testing. */

export interface ShipData {
  url: string;
  hit: boolean;
}
export interface ShipState {
  /** a service worker is controlling this page, so a cold start needs no network at all */
  controlling: boolean;
  /** which build the cache holds */
  build: string | null;
  assets: number;
  precache: number;
  data: ShipData[];
  manifest_cached: boolean;
  /** a new build id the worker has already fetched, waiting for you to reload into it */
  pending: string | null;
  note: string | null;
  /** no service worker at all: dev, or a browser that declined to store it */
  absent: boolean;
}

export const INITIAL_SHIP: ShipState = {
  controlling: false,
  build: null,
  assets: 0,
  precache: 0,
  data: [],
  manifest_cached: false,
  pending: null,
  note: null,
  absent: false,
};

const str = (v: unknown, d: string | null = null) => (typeof v === "string" && v ? v : d);
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** fold one worker message into the state; anything of another shape is ignored, not trusted */
export function applyShipMessage(s: ShipState, data: unknown): ShipState {
  if (!data || typeof data !== "object") return s;
  const m = data as Record<string, unknown>;
  switch (m.type) {
    case "chemlab:state": {
      const data_ = Array.isArray(m.data)
        ? (m.data as unknown[]).map((d) => ({ url: str((d as any)?.url, "?") ?? "?", hit: !!(d as any)?.hit }))
        : [];
      return {
        ...s,
        controlling: true,
        absent: false,
        build: str(m.build, s.build),
        assets: int(m.assets),
        precache: int(m.precache),
        data: data_,
        manifest_cached: !!m.manifest_cached,
        note: data_.length && data_.every((d) => d.hit) ? "the data files are on this device" : "the data files are not all cached yet",
      };
    }
    case "chemlab:new-data":
      return { ...s, pending: str(m.build_id, "?"), note: `data ${str(m.build_id, "?")} was fetched; nothing on screen changed` };
    case "chemlab:new-data-failed":
      return { ...s, note: `new data (${str(m.build_id, "?")}) was seen but could not be fetched; this app keeps the copy it has` };
    case "chemlab:current":
      return { ...s, controlling: true, build: str(m.build_id, s.build), pending: null };
    case "chemlab:offline":
      return { ...s, note: str(m.why, "offline: showing the cached copy") };
    case "chemlab:data-refreshed":
      return { ...s, note: m.ok ? "the data files were re-fetched into the cache" : `re-fetch failed: ${str(m.why, "no reason given")}` };
    default:
      return s;
  }
}

export function newDataAvailable(s: ShipState, currentBuild: string | null | undefined): boolean {
  const live = str(currentBuild);
  if (!live) return false;
  if (s.pending && s.pending !== live) return true;
  return false;
}

/** the sentence the header pill shows, or null for nothing to say */
export function shipPill(s: ShipState, currentBuild: string | null | undefined): string | null {
  if (s.absent) return null;
  if (newDataAvailable(s, currentBuild)) return `new data available · ${String(s.pending).slice(0, 12)}`;
  if (s.controlling && s.data.length && s.data.every((d) => d.hit)) return null; // the good state says nothing
  if (s.controlling && s.data.length) return `${s.data.filter((d) => d.hit).length}/${s.data.length} data files cached`;
  return null;
}

export function shipSummary(s: ShipState, currentBuild: string | null | undefined): { headline: string; lines: string[] } {
  const live = str(currentBuild, "unknown");
  const lines: string[] = [`this app is running data build ${live}`];
  if (s.absent)
    return {
      headline: "no offline cache in this session",
      lines: [
        "this copy of the app was opened without a service worker (a dev server, or a browser that will not store one), so it needs the files next to it every time",
        "the build under `dist/` after `npm run build` is what registers one",
      ],
    };
  if (s.pending) lines.push(`data ${s.pending} was fetched in the background and is waiting for a reload`);
  lines.push(s.manifest_cached ? "the manifest is cached, so the app knows which build it has offline" : "the manifest is not cached yet");
  for (const d of s.data) lines.push(`${d.hit ? "cached" : "not cached"} · ${d.url}`);
  lines.push(`${s.assets} of ${s.precache} shell files are in cache ${s.build ?? "?"}`);
  // an update waiting is the more important thing to say, whatever the cache stats look like
  const headline = newDataAvailable(s, currentBuild)
    ? "offline: yes, and a newer build is ready to load"
    : s.data.length > 0 && s.data.every((d) => d.hit)
      ? "offline: this whole lab is on the device"
      : "offline: only partly — the data files are still being fetched";
  return { headline, lines };
}

export function registerShip(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (typeof window === "undefined" || !window.isSecureContext) return; // a service worker needs https or localhost
  const url = new URL("sw.js", document.baseURI).href;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(url).catch(() => {
      /* a browser that refuses to store it is a browser the app still works on; the Data tab says so */
    });
  });
}

/** subscribe to the worker's state; returns an unsubscribe. The first thing it does is ask. */
export function watchShip(onState: (s: ShipState) => void): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    onState({ ...INITIAL_SHIP, absent: true, note: "this browser has no service workers" });
    return () => {};
  }
  let live = true;
  const set = (next: ShipState) => {
    if (live) onState(next);
  };
  let cur: ShipState = { ...INITIAL_SHIP, absent: true };
  const ask = () => {
    try {
      const c = navigator.serviceWorker.controller;
      if (c) c.postMessage({ type: "chemlab:check" });
      else
        navigator.serviceWorker
          .getRegistration()
          .then((r) => r?.active?.postMessage({ type: "chemlab:check" }))
          .catch(() => {});
    } catch {
      /* nothing to ask */
    }
  };
  const onMsg = (e: MessageEvent) => {
    const d = e.data as Record<string, unknown> | null;
    if (!d || typeof d.type !== "string" || !d.type.startsWith("chemlab:")) return;
    cur = applyShipMessage(cur, d);
    set(cur);
  };
  navigator.serviceWorker.addEventListener("message", onMsg);
  navigator.serviceWorker.ready
    .then((r) => {
      if (!live) return;
      cur = { ...cur, absent: false, controlling: !!r.active };
      set(cur);
      ask();
      // and once more after the first paint has settled, since the install fetches are in flight
      setTimeout(ask, 1200);
    })
    .catch(() => {
      set({ ...cur, absent: true });
    });
  return () => {
    live = false;
    navigator.serviceWorker.removeEventListener("message", onMsg);
  };
}

/** ask the worker what it has, from a button on the Data tab */
export function requestShipCheck(): void {
  try {
    const c = navigator.serviceWorker?.controller;
    if (c) c.postMessage({ type: "chemlab:check" });
    else navigator.serviceWorker?.getRegistration().then((r) => r?.active?.postMessage({ type: "chemlab:check" }));
  } catch {
    /* nothing to ask */
  }
}

/** pull the data files again into the cache, without touching the shell the user is looking at */
export function refreshShipData(): void {
  try {
    const c = navigator.serviceWorker?.controller;
    if (c) c.postMessage({ type: "chemlab:refresh-data" });
    else navigator.serviceWorker?.getRegistration().then((r) => r?.active?.postMessage({ type: "chemlab:refresh-data" }));
  } catch {
    /* nothing to ask */
  }
}

export function reloadIntoNewData(): void {
  try {
    navigator.serviceWorker.getRegistration().then((r) => {
      r?.waiting?.postMessage({ type: "chemlab:skip" });
      if (r?.active) r.active.postMessage({ type: "chemlab:refresh-data" });
    });
  } catch {
    /* reload anyway: the browser will re-check on its own */
  }
  if (typeof location !== "undefined") location.reload();
}
