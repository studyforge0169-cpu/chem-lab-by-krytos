import { useEffect, useState } from "react";
import { INITIAL_SHIP, refreshShipData, reloadIntoNewData, requestShipCheck, shipSummary, watchShip, type ShipState } from "../lib/sw.js";

/** the worker's state, kept in one place so the header pill and the Data tab never disagree */
export function useShip(): ShipState {
  const [ship, setShip] = useState<ShipState>(INITIAL_SHIP);
  useEffect(() => watchShip(setShip), []);
  return ship;
}

/** the offline card: what is cached, which build, and what happens when the data moves */
export function ShipCard({ buildId }: { buildId: string | null | undefined }) {
  const ship = useShip();
  const sum = shipSummary(ship, buildId);
  return (
    <div className="card">
      <div className="sect">offline, and what happens when the data moves</div>
      <p className="small">
        <strong>{sum.headline}</strong>
      </p>
      <ul className="small ship-list">
        {sum.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        <button className="pill-btn" onClick={() => requestShipCheck()}>
          ask the cache again
        </button>
        <button className="pill-btn" onClick={() => refreshShipData()}>
          re-fetch the data files
        </button>
        {ship.pending ? (
          <button className="pill-btn" onClick={() => reloadIntoNewData()}>
            reload into {String(ship.pending).slice(0, 12)}
          </button>
        ) : null}
      </div>
      {ship.note ? <p className="small dim">{ship.note}</p> : null}
      <p className="note">
        The worker refuses any request to another origin, so there is no font, no CDN and no
        analytics to lose: if something on this page came from outside, it would be missing, not
        slow. {ship.absent ? "Right now there is no worker, so nothing is being kept for later." : "The data files are cache-first; only the manifest is asked about, and only for its build id."}
      </p>
    </div>
  );
}
