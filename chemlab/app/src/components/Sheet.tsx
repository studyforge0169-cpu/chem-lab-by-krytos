import { useEffect, useRef, useState, type ReactNode } from "react";
import "./sheet.css";

/** A bottom sheet, because this app is operated with a thumb. Drag it down or press Esc to
 *  close; the content scrolls independently so a long element record is still readable. */
export function Sheet({ children, onClose, title }: { children: ReactNode; onClose: () => void; title?: string }) {
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  const body = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  return (
    <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label={title ?? "detail"}>
      <button className="sheet-backdrop" aria-label="close" onClick={onClose} />
      <section
        className="sheet"
        style={drag ? { transform: `translateY(${drag}px)` } : undefined}
        onTouchStart={(e) => {
          if ((body.current?.scrollTop ?? 0) > 1) return start.current !== null;
          start.current = e.touches[0].clientY;
        }}
        onTouchMove={(e) => {
          if (start.current === null) return;
          const dy = e.touches[0].clientY - start.current;
          if (dy > 0) setDrag(dy);
        }}
        onTouchEnd={() => {
          const throwAway = drag > 90;
          start.current = null;
          setDrag(0);
          if (throwAway) onClose();
        }}
      >
        <header className="sheet-grip" onDoubleClick={onClose}>
          <span />
        </header>
        <div className="sheet-body" ref={body}>
          {children}
        </div>
      </section>
    </div>
  );
}
