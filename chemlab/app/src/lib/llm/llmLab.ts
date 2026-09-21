/**
 * ChemLab AI - Unified LLM Lab Interface
 * Combines WebLLM, Python API, Ollama, Rule-based
 */

import { executeAI, type AIPlan } from "../aiLab.js";
import type { Store } from "../../data/types.js";
import { getWebLLM } from "./webLLM.js";
import { buildPrompt } from "./chemPrompt.js";

export type AISource = "webllm" | "python-api" | "ollama" | "rule-based";

export interface LLMLabResult {
  plan: AIPlan;
  source: AISource;
  model: string;
  tuned: boolean;
  latencyMs: number;
  rawLLMOutput?: any;
}

export class LLMLab {
  private store: Store;
  private useLLM: boolean = true;
  private preferredSource: AISource = "rule-based";

  constructor(store: Store) {
    this.store = store;
  }

  setUseLLM(use: boolean) { this.useLLM = use; }
  setPreferredSource(source: AISource) { this.preferredSource = source; }

  private async tryPythonAPI(query: string): Promise<any | null> {
    try {
      const res = await fetch("http://localhost:8000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, use_llm: true }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return { ...data, source: "python-api" as AISource };
    } catch { return null; }
  }

  private async tryOllama(query: string): Promise<any | null> {
    try {
      const res = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "chemlab-ai", prompt: buildPrompt(query), stream: false }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const text = data.response || "";
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return { ...parsed, source: "ollama" as AISource, model_used: "chemlab-ai (Ollama)" };
        }
      } catch {}
      return { intent: "EXPLORE", targets: [], explanation: text, source: "ollama" as AISource, model_used: "chemlab-ai" };
    } catch { return null; }
  }

  private async tryWebLLM(query: string): Promise<any | null> {
    try {
      const webllm = getWebLLM();
      if (!webllm.isReady()) return null;
      const relevant = this.getRelevantReactionsForRAG(query);
      const result = await webllm.chat(query, relevant);
      return { ...result, source: "webllm" as AISource };
    } catch (e) {
      console.warn("WebLLM failed:", e);
      return null;
    }
  }

  private getRelevantReactionsForRAG(query: string): string[] {
    const q = query.toLowerCase();
    const reactions = this.store.doc.reactions || [];
    const relevant: string[] = [];
    for (const r of reactions) {
      const text = `${r.name} ${r.equation} ${r.reactants_written} ${r.products_written}`.toLowerCase();
      if (q.split(/\s+/).some(word => word.length > 2 && text.includes(word))) {
        relevant.push(`${r.id}: ${r.name} - ${r.equation || r.reactants_written + " -> " + r.products_written}`);
        if (relevant.length >= 5) break;
      }
    }
    return relevant;
  }

  private convertLLMToPlan(llmResult: any, originalQuery: string): AIPlan {
    const basePlan = executeAI(this.store, originalQuery);
    if (llmResult && typeof llmResult === 'object') {
      if (llmResult.explanation) {
        return { ...basePlan, explanation: `[${llmResult.source || 'LLM'} - ${llmResult.model_used || 'tuned'}] ${llmResult.explanation}` };
      }
    }
    return basePlan;
  }

  async execute(query: string): Promise<LLMLabResult> {
    const start = performance.now();
    let llmResult: any = null;
    let source: AISource = "rule-based";
    let model = "rule-based (aiLab.ts) - 582 species, 424 reactions";
    let tuned = false;
    
    if (this.useLLM) {
      const order: AISource[] = 
        this.preferredSource === "webllm" ? ["webllm", "python-api", "ollama", "rule-based"] :
        this.preferredSource === "python-api" ? ["python-api", "webllm", "ollama", "rule-based"] :
        this.preferredSource === "ollama" ? ["ollama", "python-api", "webllm", "rule-based"] :
        ["python-api", "ollama", "webllm", "rule-based"];
      
      for (const src of order) {
        if (src === "python-api") {
          llmResult = await this.tryPythonAPI(query);
          if (llmResult) { source = src; model = llmResult.model_used || "chemlab-lora Python API"; tuned = !!llmResult.tuned; break; }
        } else if (src === "ollama") {
          llmResult = await this.tryOllama(query);
          if (llmResult) { source = src; model = llmResult.model_used || "chemlab-ai Ollama"; tuned = true; break; }
        } else if (src === "webllm") {
          llmResult = await this.tryWebLLM(query);
          if (llmResult) { source = src; model = llmResult.model_used || "WebLLM"; tuned = !!llmResult.tuned; break; }
        }
      }
    }
    
    const basePlan = executeAI(this.store, query);
    let finalPlan: AIPlan;
    if (llmResult) {
      finalPlan = this.convertLLMToPlan(llmResult, query);
      finalPlan.steps = [{ title: `LLM: ${source} - ${model}`, detail: `Tuned: ${tuned}, Query: "${query}"`, status: "done" }, ...finalPlan.steps];
    } else {
      finalPlan = basePlan;
      source = "rule-based";
      model = "rule-based (aiLab.ts) - fast, offline, no hallucination";
    }
    
    const latency = performance.now() - start;
    return { plan: finalPlan, source, model, tuned, latencyMs: Math.round(latency), rawLLMOutput: llmResult };
  }

  async checkBackends(): Promise<Record<AISource, boolean>> {
    const results: Record<AISource, boolean> = { "webllm": false, "python-api": false, "ollama": false, "rule-based": true };
    try { const webllm = getWebLLM(); results["webllm"] = webllm.isReady(); } catch {}
    try { const res = await fetch("http://localhost:8000/health", { method: "GET", signal: AbortSignal.timeout(1000) }); results["python-api"] = res.ok; } catch {}
    try { const res = await fetch("http://localhost:11434/api/tags", { method: "GET", signal: AbortSignal.timeout(1000) }); results["ollama"] = res.ok; } catch {}
    return results;
  }
}
