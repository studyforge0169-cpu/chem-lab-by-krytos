import type { ReactNode } from "react";
import type { Prov } from "../data/types.js";
import { view } from "../lib/format.js";
import "./prov.css";

/** The only way the app prints a number that came from the warehouse: the value and its
 *  provenance are rendered together, so no screen can quietly drop the "approx" or the
 *  citation. */
export function ProvLine({
  p,
  label,
  className = "",
  children,
}: {
  p?: Prov<any> | null;
  label?: string;
  className?: string;
  children?: (v: string, unit: string) => ReactNode;
}) {
  const v = view(p);
  if (!v) return null;
  return (
    <span
      className={`prov ${v.approx ? "prov-approx" : ""} ${v.predicted ? "prov-predicted" : ""} ${className}`}
    >
      {label ? <span className="prov-label">{label} </span> : null}
      <span className="prov-value">
        {children
          ? children(v.text, v.unit)
          : v.missing
            ? "—"
            : v.approx
              ? `≈${v.text}`
              : v.text}
        {v.unit && !v.missing ? <span className="prov-unit"> {v.unit}</span> : null}
      </span>
      {v.kelvin !== null ? <span className="prov-kelvin"> ({v.kelvin} K)</span> : null}
      {v.missing ? <span className="prov-missing">{v.missing}</span> : null}
      {v.predicted ? <span className="prov-flag">predicted</span> : null}
      {v.conf ? <span className="prov-conf">{v.conf}</span> : null}
      {v.source ? <span className="prov-src">{v.source}</span> : null}
      {v.note && !v.missing ? <span className="prov-note">{v.note}</span> : null}
    </span>
  );
}

/** A number the *app* computed. Also labelled, because arithmetic is not a measurement either. */
export function Computed({
  label,
  value,
  unit,
  basis,
}: {
  label?: string;
  value: string;
  unit?: string;
  basis: string;
}) {
  return (
    <span className="prov prov-computed">
      {label ? <span className="prov-label">{label} </span> : null}
      <span className="prov-value">
        {value}
        {unit ? <span className="prov-unit"> {unit}</span> : null}
      </span>
      <span className="prov-src">{basis}</span>
    </span>
  );
}
