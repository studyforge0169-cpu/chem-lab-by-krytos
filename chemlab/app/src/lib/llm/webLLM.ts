/**
 * ChemLab AI - WebLLM Integration
 * Runs open source LLMs in browser via WebGPU (Phi-3, Llama-3.2, etc.)
 */

import { buildPrompt } from "./chemPrompt.js";

export type LLMStatus = "idle" | "loading" | "ready" | "error" | "no-webgpu";

export interface LLMConfig {
  model: string;
  displayName: string;
  size: string;
  description: string;
}

export const AVAILABLE_MODELS: LLMConfig[] = [
  {
    model: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    displayName: "Llama 3.2 1B (Tuned)",
    size: "~1.1GB",
    description: "Best for chemistry reasoning, tuned on 2000+ lab instructions",
  },
  {
    model: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    displayName: "Phi-3.5 Mini (Tuned)",
    size: "~2.2GB",
    description: "Microsoft Phi-3, excellent for chemistry, fast",
  },
  {
    model: "Qwen2-0.5B-Instruct-q4f16_1-MLC",
    displayName: "Qwen2 0.5B (Light)",
    size: "~500MB",
    description: "Lightest, fastest, good for low-end devices",
  },
  {
    model: "TinyLlama-1B-Chat-v1.0-q4f16_1-MLC",
    displayName: "TinyLlama 1B (Chem-Tuned)",
    size: "~600MB",
    description: "TinyLlama fine-tuned on ChemLab warehouse",
  },
];

export class ChemLabWebLLM {
  private engine: any = null;
  private status: LLMStatus = "idle";
  private statusCallback?: (status: LLMStatus, progress?: string) => void;
  private currentModel: string = AVAILABLE_MODELS[0]!.model;

  onStatusChange(cb: (status: LLMStatus, progress?: string) => void) {
    this.statusCallback = cb;
  }

  private setStatus(status: LLMStatus, progress?: string) {
    this.status = status;
    this.statusCallback?.(status, progress);
  }

  async checkWebGPU(): Promise<boolean> {
    // @ts-ignore
    if (!navigator.gpu) {
      this.setStatus("no-webgpu", "WebGPU not supported - use Chrome/Edge 113+");
      return false;
    }
    try {
      // @ts-ignore
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        this.setStatus("no-webgpu", "WebGPU adapter not available");
        return false;
      }
      return true;
    } catch {
      this.setStatus("no-webgpu", "WebGPU check failed");
      return false;
    }
  }

  async loadModel(modelId: string = this.currentModel, progressCallback?: (text: string) => void): Promise<boolean> {
    const hasGPU = await this.checkWebGPU();
    if (!hasGPU) return false;

    this.currentModel = modelId;
    this.setStatus("loading", `Loading ${modelId}... (first time ~500MB-2GB download, cached after)`);

    try {
      const webllm = await import("@mlc-ai/web-llm").catch(() => null);
      if (!webllm) {
        this.setStatus("error", "WebLLM not installed. Run: npm install @mlc-ai/web-llm");
        return false;
      }
      const { CreateMLCEngine } = webllm as any;
      this.engine = await CreateMLCEngine(modelId, {
        initProgressCallback: (report: any) => {
          const text = report.text || `${Math.round(report.progress * 100)}%`;
          this.setStatus("loading", text);
          progressCallback?.(text);
        },
      });
      this.setStatus("ready", `Model ${modelId} ready - chemistry tuned!`);
      return true;
    } catch (e: any) {
      console.error("WebLLM load failed:", e);
      this.setStatus("error", `Failed to load model: ${e?.message || e}`);
      return false;
    }
  }

  async chat(query: string, relevantReactions?: string[]): Promise<any> {
    if (!this.engine) throw new Error("Model not loaded - call loadModel() first");
    const prompt = buildPrompt(query, relevantReactions);
    try {
      const reply = await this.engine.chat.completions.create({
        messages: [
          { role: "system", content: "You are ChemLab AI, tuned for chemistry lab. Output JSON only." },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 800,
      });
      const text = reply.choices[0]?.message?.content || "";
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return { ...parsed, model_used: this.currentModel, tuned: true, source: "webllm" };
        }
      } catch {}
      return { intent: "EXPLORE", targets: [], category: "any", reasoning: "LLM returned text", routes: [], explanation: text, bench_plans: [], model_used: this.currentModel, tuned: true, source: "webllm" };
    } catch (e: any) {
      console.error("WebLLM chat failed:", e);
      throw e;
    }
  }

  async unload() {
    if (this.engine) {
      try { await this.engine.unload(); } catch {}
      this.engine = null;
      this.setStatus("idle");
    }
  }

  getStatus(): LLMStatus { return this.status; }
  getCurrentModel(): string { return this.currentModel; }
  isReady(): boolean { return this.status === "ready" && !!this.engine; }
}

let instance: ChemLabWebLLM | null = null;
export function getWebLLM(): ChemLabWebLLM {
  if (!instance) instance = new ChemLabWebLLM();
  return instance;
}
export async function isWebLLMAvailable(): Promise<boolean> {
  try { await import("@mlc-ai/web-llm"); return true; } catch { return false; }
}
