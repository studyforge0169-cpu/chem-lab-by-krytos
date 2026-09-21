# ChemLab Final Package — Hacker Red Black White + Chemistry AI Engine

This zip includes complete app with all latest features.

## What's Included

### 1. App (chemlab/app/)
- **src/** — Full React + TypeScript source
  - `src/lib/chemistry-ai/` — Chemistry AI Design Engine (NEW, 10 files, 4000+ lines, 47 tests passing)
    - domain.ts — Core domain models, deterministic hashing, SearchConfig
    - goalInterpreter.ts — GoalInterpreter (tensile strength, adhesion, solidification, etc., safety BLOCKED)
    - chemistrySpec.ts — ChemistrySpecification normalized, JSON serializable
    - designSpace.ts — DesignSpace for molecule/polymer/material/formulation/catalyst/etc.
    - generators.ts — Pluggable CandidateGenerator (random/fragment/evolutionary/bayesian/generative-model adapter/composite)
    - engines.ts — ConstraintEngine, SafetyEngine (SAFE/REVIEW_REQUIRED/RESTRICTED/BLOCKED), PredictorRegistry (mock labeled), SimulationEngine (NOT_AVAILABLE if no real engine), ScoringEngine + Pareto
    - searchController.ts — SearchController, SearchStateManager, CandidateMemory (minimal storage), CheckpointManager (resumable), ActiveLearningController
    - toolRegistry.ts — ToolRegistry 10 tools, ChemistryAgent (LLM -> Tool Router -> Search -> Report)
    - api.ts — InMemoryChemistryAIAPI (POST /chemistry/goals, /chemistry/search, etc.)
    - index.ts — Factory createChemistryAISystem(), demo
    - demo.ts — Demo with 4 example goals
    - __tests__/chemistryAI.test.ts — 47 comprehensive tests
    - README.md — Full architecture docs
  - `src/lib/worldChemistry.ts` — World chemistry knowledge (118 elements, 5000+ compounds, 200+ templates)
  - `src/lib/chemistryEngine.ts` — ChemistryEngine wrapper
  - `src/lib/aiLab.ts` — AI Lab with world knowledge intents BALANCE/PREDICT/WORLD_KNOWLEDGE
  - `src/lib/llm/` — WebLLM (Phi-3.5, Llama-3.2, Qwen2, TinyLlama) + chemPrompt with world knowledge
  - `src/styles/app.css` — Hacker red/black/white futuristic terminal (grid, scanlines, glow, animations)
  - `src/styles/hacker.css` — Global hacker override, fixed overlays, upgraded animations (62KB CSS)
  - `src/screens/ai.css` — AI Lab hacker terminal (red user bubbles, black AI bubbles with > prompt)
  - `src/screens/table.css`, bench.css, shelf.css, etc. — All fixed for no overlay, hacker theme
  - `src/App.tsx` — Header CHEMLAB // HACKER TERMINAL v2.0 with glitch, chips
  - `src/state/`, `src/components/` — App state, sheets, findbar, etc.
- **public/data/** — 18MB chemistry data: chemlab.json.gz (582 substances, 424 reactions), combinations.json.gz (9410 pairs), manifest.json
- **dist/** — Built production app (7.7MB), ready to serve: index.html, assets/style-*.css (62KB hacker), assets/index-*.js (527KB main + 6MB WebLLM chunk), sw.js
- **scripts/** — sync-data.mjs, prune-dist.mjs, gen-sw.mjs, make-icons.mjs
- **package.json**, **vite.config.ts**, **tsconfig.json**, **index.html**

### 2. AI Backend (chemlab/ai/)
- **api.py** — FastAPI backend for ChemLab AI (world knowledge)
- **chemistry_ai_core.py** — Python mirror of Chemistry AI engine (GoalInterpreter, Generator, MockPredictor, SafetyEngine, SearchController, demo) — runs same pipeline as TS
- **world_chemistry.py** — World chemistry knowledge for Python
- **world_dataset.py** — Generates 182 world chemistry instruction pairs
- **dataset.py** — Generates chemistry dataset (165 pairs)
- **model.py** — Mock inference + CHEM_SYSTEM_PROMPT
- **train.py** — LoRA training for TinyLlama/Phi-3
- **requirements.txt**
- **Modelfile** — Ollama Modelfile for chemlab-ai (llama3.2:1b tuned)
- **chemistry_dataset.json** (80KB), **world_chemistry_dataset.json** (93KB), **dataset_hf.jsonl**, **world_dataset_hf.jsonl**
- **chemlab-lora/** — Tuning report

### 3. Data & Spec (chemlab/)
- **data_curated/** — Curated chemistry data tables
- **spec/** — COMBINATORICS.md, DATA_SCHEMA.md, ENGINE.md, SAFETY.md
- **scripts/** — build_warehouse.py, fetch_pubchem.py, etc.
- **README.md**, **PLAN.md**, **START-HERE.txt**

### 4. Theme
- **Hacker Red Black White Futuristic** — Pure black #000 with red grid (32px), scanlines, neon red glow #ff0033, JetBrains Mono bold 800 uppercase, glitch, flicker, scanLine, tabActive, cardIn stagger, pulseRed, cursorBlink animations
- **Fixed overlays** — No floating red cover, all texts visible, main padding 110px to prevent table hidden behind tabs, pill-btn::before removed

## How to Run

### Frontend (App)
```bash
cd chemlab/app
npm install
npm run dev → http://localhost:5173
npm run build → dist/
npm run serve → serve dist/
```

### Chemistry AI Engine (TS)
```bash
cd chemlab/app
npx vitest run src/lib/chemistry-ai/__tests__/chemistryAI.test.ts → 47 tests passing
npx tsx src/lib/chemistry-ai/demo.ts → demo with 4 goals
```

### AI Backend (Python)
```bash
cd chemlab/ai
pip install -r requirements.txt
python api.py → http://localhost:8000
python chemistry_ai_core.py → demo pipeline
python world_dataset.py → generate world dataset
```

### Ollama
```bash
ollama create chemlab-ai -f chemlab/ai/Modelfile
ollama run chemlab-ai
```

## Chemistry AI Pipeline Demo

```typescript
import { createChemistryAISystem } from "./src/lib/chemistry-ai/index.js";
const system = createChemistryAISystem();
const result = await system.agent.processGoal("Design a material with extremely high tensile strength and rapid solidification and strong adhesion");
console.log(result.report);
// Top candidates with predicted properties, uncertainty, safety, provenance, Pareto front
// IMPORTANT STATUS: COMPUTATIONAL PREDICTIONS ONLY - NOT EXPERIMENTALLY VALIDATED
```

## Safety

- SafetyEngine mandatory: SAFE/REVIEW_REQUIRED/RESTRICTED/BLOCKED
- Blocks hazardous: explosive, chemical weapon, nerve agent, illicit drugs, radioactive
- Mock predictors labeled NOT SCIENTIFICALLY VALIDATED
- Simulation returns NOT_AVAILABLE if no real engine
- Never claims experimental validation

## Version

- ChemLab Hacker v2.0 + Chemistry AI v1.0.0-mvp-search-engine-first
- Build: 105 modules, 62KB CSS hacker, 527KB main, 6MB WebLLM
- Tests: 47 passing
- Data: 582 substances, 424 reactions, 9410 element pairs, 118 elements, 5000+ world compounds, 200+ templates

## Zip Files

- chem-lab-final-hacker-ai.zip (6.7MB) — Complete with app/src, public/data, dist, ai, data_curated, spec, scripts
- chem-lab-complete-all.zip (3.3MB) — Complete without dist
- chem-lab-deploy-ready.zip (6.1MB) — dist + public + ai + chemistry-ai

All pushed to arena/01a0c2e2-chem-lab-by-krytos branch, commits:
- 0f34a57 feat: LLM install
- 81dadfa feat: world chemistry knowledge
- 8204b9a feat: hacker red black white UI
- 73511f2 fix: upgrade hacker and fix overlays
- f93c994 fix: remove floating red overlay
- 5563da3 fix: increase main padding
- a2c3021 feat: Chemistry AI design engine
