import { useState, useRef, useEffect, useMemo } from "react";
import { useApp } from "../state/app.js";
import { executeAI, getQuickPrompts, type AIPlan } from "../lib/aiLab.js";
import { formula, eq } from "../lib/format.js";
import { decideMix } from "../lib/mix.js";
import "./ai.css";

interface ChatMsg {
  id: string;
  role: "user" | "ai";
  text: string;
  plan?: AIPlan;
  time: string;
}

export function AIScreen() {
  const { store, bench, setBench, open, ctx } = useApp();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>(() => {
    try {
      const raw = localStorage.getItem("chemlab.ai_chat.v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch {}
    return [
      {
        id: "welcome",
        role: "ai",
        text: "Hi, I'm your AI Lab Assistant 🤖⚗️\n\nSay anything and I'll handle the lab:\n• \"make water\" → I find all 64 ways to make H2O\n• \"make an acid\" → I make many acids by selecting elements/molecules\n• \"make H2SO4 in all possible ways\" → I go through every possible lab route\n• \"what can I make from Na and Cl?\"\n\nI use the real warehouse: 582 substances, 424 reactions, 9410 element pairs. No guesses.",
        time: new Date().toISOString(),
      },
    ] as ChatMsg[];
  });
  const [isThinking, setIsThinking] = useState(false);
  const [listening, setListening] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const quickPrompts = useMemo(() => getQuickPrompts(), []);

  useEffect(() => {
    try {
      localStorage.setItem("chemlab.ai_chat.v1", JSON.stringify(messages.slice(-30)));
    } catch {}
  }, [messages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      if (ce.detail && typeof ce.detail === "string") {
        handleSend(ce.detail);
      }
    };
    window.addEventListener("ai-quick-send" as any, handler);
    return () => window.removeEventListener("ai-quick-send" as any, handler);
  }, [store]);

  const handleSend = (text: string = input) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const userMsg: ChatMsg = {
      id: `u_${Date.now()}`,
      role: "user",
      text: trimmed,
      time: new Date().toISOString(),
    };
    setMessages(m => [...m, userMsg]);
    setInput("");
    setIsThinking(true);

    setTimeout(() => {
      try {
        const plan = executeAI(store, trimmed);
        const aiMsg: ChatMsg = {
          id: `ai_${Date.now()}`,
          role: "ai",
          text: plan.explanation,
          plan,
          time: new Date().toISOString(),
        };
        setMessages(m => [...m, aiMsg]);
      } catch (e: any) {
        const aiMsg: ChatMsg = {
          id: `ai_${Date.now()}`,
          role: "ai",
          text: `Error: ${String(e?.message || e)}. Try rephrasing like "make water" or "make an acid".`,
          time: new Date().toISOString(),
        };
        setMessages(m => [...m, aiMsg]);
      } finally {
        setIsThinking(false);
      }
    }, 550);
  };

  const handleVoice = () => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      alert("Voice not supported in this browser. Try Chrome or Edge.");
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    setListening(true);
    rec.onresult = (e: any) => {
      const t = e.results[0][0].transcript;
      setInput(t);
      setTimeout(() => handleSend(t), 100);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    rec.start();
  };

  const loadBench = (items: typeof bench) => {
    if (items.length > 4) {
      if (!confirm(`This route needs ${items.length} bottles but bench holds 4. Load first 4?`)) return;
      setBench(items.slice(0, 4));
    } else {
      setBench(items);
    }
    const msg: ChatMsg = {
      id: `sys_${Date.now()}`,
      role: "ai",
      text: `✅ Loaded ${items.slice(0, 4).map(i => store.speciesById.get(i.species_id)?.formula_written || i.species_id).join(" + ")} onto bench. Go to Bench tab to see what happens - colour, gas, heat, pH, safety guard.`,
      time: new Date().toISOString(),
    };
    setMessages(m => [...m, msg]);
  };

  const clearChat = () => {
    if (confirm("Clear AI chat history?")) {
      const welcome = messages.find(m => m.id === "welcome") || messages[0];
      setMessages(welcome ? [welcome] : []);
      localStorage.removeItem("chemlab.ai_chat.v1");
    }
  };

  return (
    <div className="ai-screen">
      <div className="ai-header">
        <div className="ai-title">
          <span className="ai-glyph">🤖</span>
          <div>
            <h2>AI Lab Assistant</h2>
            <p className="small">Say anything — I handle the lab, every possible way</p>
          </div>
        </div>
        <div className="ai-stats">
          <span className="chip">{store.counts.species} substances</span>
          <span className="chip">{store.counts.reactions} reactions</span>
          <button className="pill-btn small" onClick={clearChat}>clear</button>
        </div>
      </div>

      <div className="ai-quick">
        {quickPrompts.map(q => (
          <button key={q} className="pill-btn ai-quick-btn" onClick={() => handleSend(q)}>
            {q}
          </button>
        ))}
      </div>

      <div className="ai-chat">
        {messages.map(m => (
          <div key={m.id} className={`ai-msg ${m.role}`}>
            <div className="ai-msg-bubble">
              <div className="ai-msg-text">{m.text}</div>
              {m.plan && <AIPlanView plan={m.plan} store={store} onLoadBench={loadBench} open={open} ctx={ctx} onSuggest={handleSend} />}
            </div>
            <div className="ai-msg-time small">{new Date(m.time).toLocaleTimeString()}</div>
          </div>
        ))}
        {isThinking && (
          <div className="ai-msg ai">
            <div className="ai-msg-bubble thinking">
              <div className="ai-think">
                <span className="dot" /> <span className="dot" /> <span className="dot" />
                <span>AI is searching warehouse, planning routes, checking safety...</span>
              </div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="ai-input-row">
        <div className="ai-input-wrap">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleSend(); }}
            placeholder='Say anything: "make water", "make an acid", "make H2SO4 in all ways"...'
            aria-label="Ask AI lab assistant"
          />
          <button className={`icon-btn ${listening ? "listening" : ""}`} onClick={handleVoice} title="Speak">
            {listening ? "🔴" : "🎤"}
          </button>
          <button className="pill-btn primary" onClick={() => handleSend()} disabled={!input.trim() || isThinking}>
            Send
          </button>
        </div>
        <p className="small dim ai-hint">
          AI uses real data: no hallucinated reactions. Every route is from 424 curated reactions + 380 ion pairs + 9410 element combos. Bench auto-loads.
        </p>
      </div>
    </div>
  );
}

function AIPlanView({ plan, store, onLoadBench, open, ctx, onSuggest }: { plan: AIPlan; store: any; onLoadBench: (items: any) => void; open: any; ctx: any; onSuggest: (t: string) => void }) {
  const [expanded, setExpanded] = useState<string | null>(plan.speciesRoutes[0]?.species.id || null);
  const [showAll, setShowAll] = useState(false);

  const visibleRoutes = showAll ? plan.speciesRoutes : plan.speciesRoutes.slice(0, 6);

  return (
    <div className="ai-plan">
      <div className="ai-steps">
        {plan.steps.map((s, i) => (
          <div key={i} className={`ai-step ${s.status}`}>
            <span className="ai-step-glyph">{s.status === "done" ? "✓" : s.status === "thinking" ? "◐" : "○"}</span>
            <div>
              <div className="ai-step-title">{s.title}</div>
              <div className="small dim">{s.detail}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="ai-stats-row">
        <span className="chip chip-ok">{plan.stats.speciesFound} substances</span>
        <span className="chip chip-warn">{plan.stats.reactionsFound} routes</span>
        <span className="chip">{plan.stats.benchOptions} bench setups</span>
        {plan.query.category && <span className="chip">category: {plan.query.category}</span>}
        {plan.query.fromElements && <span className="chip">from: {plan.query.fromElements.join(", ")}</span>}
      </div>

      {plan.warnings.length > 0 && (
        <div className="ai-warnings">
          {plan.warnings.map((w, i) => (
            <div key={i} className="warn">⚠️ {w}</div>
          ))}
        </div>
      )}

      <div className="ai-routes">
        <div className="sect">Every possible way — using the lab ({visibleRoutes.length} shown)</div>
        {visibleRoutes.map(sr => {
          const isExp = expanded === sr.species.id;
          const mixPreview = (() => {
            if (sr.routes[0]?.bench?.length) {
              try {
                const benchItems = sr.routes[0].bench.map((b: any) => ({ species_id: b.species_id, qty: b.qty, unit: b.unit }));
                const mix = decideMix(benchItems as any, store, ctx);
                return mix;
              } catch { return null; }
            }
            return null;
          })();

          return (
            <div key={sr.species.id} className={`ai-route-card ${isExp ? "expanded" : ""}`}>
              <div className="ai-route-head" onClick={() => setExpanded(isExp ? null : sr.species.id)}>
                <div className="ai-route-who">
                  <strong>{formula(sr.species.formula_written || sr.species.name)}</strong>
                  <span className="small">{sr.species.name}</span>
                  {sr.species.elements && <span className="small dim"> {Object.entries(sr.species.elements).map(([el, n]) => `${el}${(n as number) > 1 ? n : ""}`).join("")}</span>}
                </div>
                <div className="ai-route-meta">
                  <span className="chip">{sr.routes.length} routes</span>
                  <span className="small">{sr.elements.join(" + ")}</span>
                  <span className="glyph">{isExp ? "−" : "+"}</span>
                </div>
              </div>

              {isExp && (
                <div className="ai-route-body">
                  <div className="ai-route-actions">
                    <button className="pill-btn small" onClick={() => open({ kind: "species", id: sr.species.id })}>View {sr.species.id}</button>
                    {sr.routes[0] && (
                      <button className="pill-btn primary small" onClick={() => onLoadBench(sr.routes[0].bench)}>
                        ⚗️ Load best route to bench
                      </button>
                    )}
                  </div>

                  {mixPreview && (
                    <div className="ai-mix-preview">
                      <div className="small"><strong>Bench preview:</strong> {mixPreview.statusLine}</div>
                      {mixPreview.branch === "reaction" && mixPreview.reaction && (
                        <div className="small">→ {mixPreview.reaction.name}: {eq(mixPreview.reaction.equation || "")}</div>
                      )}
                    </div>
                  )}

                  <div className="ai-reaction-list">
                    {sr.routes.slice(0, 5).map((r, idx) => (
                      <div key={idx} className="ai-reaction-item">
                        <div className="ai-reaction-head">
                          <span className={`chip ${r.type === "direct" ? "chip-ok" : r.type === "precipitation" ? "chip-warn" : "chip"}`}>{r.type}</span>
                          <strong className="small">{r.reaction.name}</strong>
                          {r.safetyNote && <span className="chip chip-danger small">{r.safetyNote}</span>}
                        </div>
                        <div className="mono small ai-equation">{eq(r.reaction.equation || `${r.reaction.reactants_written} → ${r.reaction.products_written}`)}</div>
                        <div className="small dim">{r.reason}</div>
                        {r.observations.length > 0 && (
                          <div className="ai-obs">
                            {r.observations.map((o, i) => (
                              <span key={i} className="chip small">{o}</span>
                            ))}
                          </div>
                        )}
                        <div className="ai-bench-mini">
                          <span className="small">Bench: {r.bench.map((b: any) => {
                            const sp = store.speciesById.get(b.species_id);
                            return sp?.formula_written || b.species_id;
                          }).join(" + ")} → {formula(sr.species.formula_written || "")}</span>
                          <button className="pill-btn small" onClick={() => onLoadBench(r.bench)}>Load</button>
                          <button className="pill-btn small" onClick={() => open({ kind: "reaction", id: r.reaction.id })}>View reaction</button>
                        </div>
                      </div>
                    ))}
                    {sr.routes.length > 5 && <div className="small dim">+ {sr.routes.length - 5} more routes for {sr.species.name}</div>}
                  </div>

                  {sr.routes.length === 0 && (
                    <div className="note">
                      No curated synthesis route in 424 reactions. But you can still try: put precursors on bench manually, or check element combinations. Elements needed: {sr.elements.join(", ")}.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {plan.speciesRoutes.length > 6 && !showAll && (
        <button className="pill-btn" onClick={() => setShowAll(true)}>Show all {plan.speciesRoutes.length} substances ({plan.stats.reactionsFound} routes)</button>
      )}

      {plan.benchPlans.length > 0 && (
        <div className="ai-bench-plans">
          <div className="sect">Quick bench setups — one click to run lab</div>
          <div className="bench-grid">
            {plan.benchPlans.slice(0, 8).map((bp, i) => (
              <div key={i} className="bench-plan-card">
                <div className="small"><strong>{bp.label}</strong></div>
                <div className="small mono">{bp.items.map((it: any) => store.speciesById.get(it.species_id)?.formula_written || it.species_id).join(" + ")}</div>
                <button className="pill-btn small primary" onClick={() => onLoadBench(bp.items)}>⚗️ Run on bench</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ai-suggestions">
        <div className="small dim">Try next:</div>
        <div className="suggest-row">
          {plan.suggestions.map(s => (
            <button key={s} className="pill-btn small" onClick={() => onSuggest(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <details className="ai-debug">
        <summary className="small dim">AI debug — how I understood "{plan.query.raw}"</summary>
        <pre className="small mono">{JSON.stringify(plan.query, null, 2)}</pre>
      </details>
    </div>
  );
}
