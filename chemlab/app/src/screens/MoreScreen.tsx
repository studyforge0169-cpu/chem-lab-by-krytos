import { useApp } from "../state/app.js";
import { g } from "../lib/format.js";
import { ShipCard } from "../components/Ship.js";

/** The data panel: which build is this, how big was it, how fast did it load, and what is
 *  honest about it. Kept as a screen rather than a console.log, because “which data was
 *  this answer computed from?” is a question a student should be able to ask. */
export function MoreScreen() {
  const { store, manifest, timings } = useApp();
  const c = store.counts;
  const files = manifest?.files ?? {};
  return (
    <div>
      <div className="card">
        <div className="sect">This build</div>
        <dl className="kv">
          <dt>data generated</dt>
          <dd className="mono">{store.dataGenerated || "unknown"}</dd>
          <dt>manifest</dt>
          <dd className="mono">{manifest ? `${manifest.build_id} @ ${manifest.generated}` : "no manifest - a bare copy of the files"}</dd>
          <dt>elements</dt>
          <dd>{c.elements} · all of them, Z ≥ 100 marked predicted</dd>
          <dt>substances</dt>
          <dd>{c.species}</dd>
          <dt>reactions</dt>
          <dd>{c.reactions}</dd>
          <dt>ion pairs</dt>
          <dd>{c.ion_pairs}</dd>
          <dt>element pairs</dt>
          <dd>{c.combinations.toLocaleString("en-US")}</dd>
          <dt>Ksp / pKa / E°</dt>
          <dd>
            {c.ksp} / {c.pka} / {c.e0}
          </dd>
        </dl>
      </div>

      <div className="card">
        <div className="sect">Load cost</div>
        <dl className="kv">
          <dt>transfer</dt>
          <dd>{g(timings.bytes / 1024, 3)} KB gzipped</dd>
          <dt>fetch</dt>
          <dd>{g(timings.fetch_ms, 3)} ms</dd>
          <dt>inflate</dt>
          <dd>{g(timings.inflate_ms, 3)} ms</dd>
          <dt>parse</dt>
          <dd>{g(timings.parse_ms, 3)} ms</dd>
          <dt>index</dt>
          <dd>{g(timings.index_ms, 3)} ms</dd>
          <dt>total</dt>
          <dd>
            <strong>{g(timings.total_ms, 3)} ms</strong>
          </dd>
        </dl>
        {Object.entries(files).map(([f, m]: [string, any]) => (
          <p key={f} className="small mono">
            {f} · {g(m.bytes / 1024, 4)} KB · sha {String(m.sha256).slice(0, 10)}
          </p>
        ))}
      </div>

      <ShipCard buildId={store.buildId ? String(store.buildId) : null} />

      <div className="card">
        <div className="sect">Where the numbers come from</div>
        {(store.doc.meta?.licenses ?? []).map((l) => (
          <p key={l.dataset} className="small">
            <strong>{l.dataset}</strong> — {l.license}
            {l.attribution ? ` — ${l.attribution}` : ""}
          </p>
        ))}
        <p className="note">
          Anything the app itself computes is labelled as computed. Anything the warehouse does
          not know stays empty with a reason; the app never fills a gap with a plausible number.
        </p>
      </div>
    </div>
  );
}
