# AGY Multi-Surface & Multi-Model Orchestrator (`orch`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/home/aswath/agy-orchestrator` (`orch` CLI + Tactical Telemetry Web Control Center + Phone Automation Bridge) controlling `agy` (WSL & Windows across both Gemini and Claude/GPT model categories), `cmdc`, and `mcode` with 3-tier MemGPT/`claude-mem` hybrid memory, Thompson Sampling skill/model routing, contrastive learning loop, and phone-to-harness automation.

**Architecture:** Zero-dependency Node.js (v20 ESM) core orchestrator coupled with a fast Python 3 (`sqlite3` FTS5 + `numpy` 2.5.2) hybrid memory & vector retrieval engine. Live topology (`config/topology.json`), taste profile (`taste/taste-profile.json`), phone bridge (`src/automation/phone-bridge.mjs`), and Tactical Telemetry Web UI (`src/ui/` on port `4888` with SSE) operate over a shared event bus and SQLite WAL storage.

**Tech Stack:** Node.js v20 ESM (`node:http`, `node:child_process`, `node:fs`, `node:test`), Python 3.12 (`sqlite3` FTS5 BM25, `numpy` 2.5.2 384-d float32 embeddings), existing local CLIs (`agy`, `agy.exe`, `cmdc`, `mcode`), existing `claude-mem.db` (`?immutable=1` + worker API `127.0.0.1:37777`).

**Spec:** `/home/aswath/agy-orchestrator/docs/superpowers/specs/2026-11-10-agy-orchestrator-design.md`

## Global Constraints

- Zero paid external API keys required; all LLM inference routes through authenticated local CLI binaries (`agy` WSL, `agy.exe` Windows, `cmdc`, `mcode`).
- Zero npm build-step bloat (`/ponytail [ultra]`): use Node.js built-ins and Python standard library + installed `numpy`.
- Both `agy` model categories must be first-class citizens: Category A (`gemini-4-argon-*`, `gemini-3.8-flash-*`) and Category B (`claude-opus-5-5-*`, `claude-sonnet-5-5-*`, `gpt-oss-120b-medium`).
- Leader and subagent assignments must be 100% dynamic and runtime-tweakable via CLI (`orch set-leader`, `orch swap`, `orch worker`) and Web UI (`http://127.0.0.1:4888`).
- Web UI must strictly follow `industrial-brutalist-ui` (Archetype 2.2: `#0A0A0A` CRT carbon, `#EAEAEA` phosphor text, `#E61919` aviation red accent, `#4AF626` single status indicator, `0px` border-radius, `1px` CSS Grid compartments, `Archivo Black` + `JetBrains Mono`) and `design-taste-frontend` (no emojis, tactile active states, spring/fluid transitions).

## Review Focus

1. **WSL ↔ Windows UNC Path Rejection in `cmd.exe`**: Invoking `cmd.exe /c agy.exe` from `/home/aswath/...` prints a UNC warning and resets CWD to `C:\Windows`. The Windows adapter must execute from `C:\Users\aswat` (via `/mnt/c/Users/aswat/.agy-orch-bridge`) and translate paths cleanly.
2. **WSL2 `9p` SQLite Locking on `claude-mem.db`**: Querying `/mnt/c/Users/aswat/.claude-mem/claude-mem.db` from WSL without `?immutable=1` throws `disk I/O error`. All cross-OS reads on `claude-mem.db` must use `file:/mnt/c/Users/aswat/.claude-mem/claude-mem.db?immutable=1` while primary write storage (`orch-mem.db`) stays on WSL ext4 (`/home/aswath/agy-orchestrator/memory/orch-mem.db`).
3. **Subagent / CLI Hang or Quota Failure**: If a specific model or surface times out or hits a quota/budget error, the adapter must catch it, record a negative bandit reward, and gracefully fall back to the next best brain.
4. **Phone Inbox Re-Execution Loop**: Watching `/mnt/c/Users/aswat/OneDrive/Orch-Phone-Inbox.md` must atomically transition `- [ ]` to `- [~]` before dispatching so file-watcher debounce never triggers duplicate runs of the same phone note.
5. **Self-Improvise Safety**: Running a self-evolution task from the Web UI must create a git snapshot commit first so broken edits can be reverted cleanly.

---

### Task 1: Project Scaffold, Live Topology Controller, Cross-OS Path & Theme Bridge

**Files:**
- Create: `/home/aswath/agy-orchestrator/package.json`
- Create: `/home/aswath/agy-orchestrator/config/topology.json`
- Create: `/home/aswath/agy-orchestrator/src/adapters/path-bridge.mjs`
- Create: `/home/aswath/agy-orchestrator/src/topology/controller.mjs`
- Test: `/home/aswath/agy-orchestrator/test/topology.test.mjs`

**Interfaces:**
- Produces:
  - `toWinPath(posixPath)` / `toWslPath(winPath)` / `ensureBridgeDir()`
  - `getThemes()` / `setAgyTheme(scheme, targets)`
  - `TopologyController`: `load()`, `save()`, `setLeader(spec, opts)`, `swapLeaderWithSubagent(subId)`, `upsertWorker(id, spec)`, `removeWorker(id)`, `setPolicy(key, val)`

- [ ] **Step 1: Write the failing test in `test/topology.test.mjs`**
- [ ] **Step 2: Run `node --test test/topology.test.mjs` to verify it fails**
- [ ] **Step 3: Implement `package.json`, `config/topology.json`, `path-bridge.mjs`, and `controller.mjs`**
- [ ] **Step 4: Run `node --test test/topology.test.mjs` and verify it passes**

---

### Task 2: 3-Tier MemGPT + `claude-mem` Hybrid Memory Engine (SQLite FTS5 BM25 + `numpy` Dense Vectors + RRF)

**Files:**
- Create: `/home/aswath/agy-orchestrator/src/memory/hybrid_engine.py`
- Create: `/home/aswath/agy-orchestrator/src/memory/manager.mjs`
- Create: `/home/aswath/agy-orchestrator/taste/taste-profile.json`
- Create: `/home/aswath/agy-orchestrator/src/taste/engine.mjs`
- Test: `/home/aswath/agy-orchestrator/test/memory-taste.test.mjs`

**Interfaces:**
- Consumes: `TopologyController`, `path-bridge.mjs`
- Produces:
  - `MemoryManager`: `init()`, `storeMemory({ tier, category, title, content, tags, sessionId, salience })`, `searchHybrid(query, { limit, includeClaudeMem, sessionId })`, `saveHandoff(sessionId, handoffObj)`, `getSessionContext(sessionId)`, `syncTranscriptToClaudeMem(sessionObj)`
  - `TasteEngine`: `loadProfile()`, `updateProfile(patch)`, `compileTasteContract()`, `scoreOutput(outputText)`

- [ ] **Step 1: Write the failing test in `test/memory-taste.test.mjs` covering FTS5 + dense vector RRF ranking, `claude-mem.db` (`?immutable=1`) live query across 9,541 observations, and Taste Contract compilation**
- [ ] **Step 2: Run `node --test test/memory-taste.test.mjs` to verify it fails**
- [ ] **Step 3: Implement `hybrid_engine.py` (SQLite FTS5 + 384-d `numpy` feature-hashed n-gram embeddings + RRF + `claude-mem.db` bridge), `manager.mjs`, `taste-profile.json`, and `taste/engine.mjs`**
- [ ] **Step 4: Run `node --test test/memory-taste.test.mjs` and verify it passes**

---

### Task 3: Two-Stage Thinking Skill Router + Contextual Thompson Sampling Bandit + Learning Loop

**Files:**
- Create: `/home/aswath/agy-orchestrator/src/router/skill-router.mjs`
- Create: `/home/aswath/agy-orchestrator/src/learning/loop.mjs`
- Test: `/home/aswath/agy-orchestrator/test/router-learning.test.mjs`

**Interfaces:**
- Consumes: `MemoryManager`, `TasteEngine`, `TopologyController`
- Produces:
  - `SkillRouter`: `indexLocalSkills()`, `routeTask(prompt, { maxSkills, autoInstall })`, `installSkill(queryOrPkg)`, `synthesizeSkill({ name, description, instructions })`, `selectAgentsBandit(taskVector, topology)`
  - `LearningLoop`: `recordOutcome({ task, surface, model, category, skills, success, latencyMs, tasteScore, error, correction })`, `recordContrastivePair({ cluster, rejected, chosen, rootCause })`, `consolidateRules()`, `getBanditStats()`

- [ ] **Step 1: Write the failing test in `test/router-learning.test.mjs` verifying local `~/.agents/skills` indexing, hybrid skill matching, Thompson Sampling posterior updates, and DPO contrastive rule consolidation**
- [ ] **Step 2: Run `node --test test/router-learning.test.mjs` to verify it fails**
- [ ] **Step 3: Implement `skill-router.mjs` and `learning/loop.mjs`**
- [ ] **Step 4: Run `node --test test/router-learning.test.mjs` and verify it passes**

---

### Task 4: Multi-Surface CLI Brain Adapters (`agy-wsl`, `agy-win`, `cmdc`, `mcode`) & Orchestrator Execution Engine

**Files:**
- Create: `/home/aswath/agy-orchestrator/src/adapters/index.mjs`
- Create: `/home/aswath/agy-orchestrator/src/orchestrator/engine.mjs`
- Test: `/home/aswath/agy-orchestrator/test/orchestrator.test.mjs`

**Interfaces:**
- Consumes: `TopologyController`, `MemoryManager`, `TasteEngine`, `SkillRouter`, `LearningLoop`
- Produces:
  - `runBrain({ surface, model, effort, prompt, systemContext, skills, cwd, timeoutMs, onStream, dryRun })`
  - `OrchestratorEngine`: `executeTask(prompt, { mode, sessionId, forceLeader, dryRun })`, `improviseSelf(featureRequest)`, live `events` EventEmitter for SSE streaming.

- [ ] **Step 1: Write the failing test in `test/orchestrator.test.mjs` testing command construction for `agy-wsl`, `agy-win`, `cmdc`, and `mcode`, complexity gating (`single` vs `full` vs `egm` Elephant+Goldfish review), and dual-category (Gemini + Claude/GPT) dispatch**
- [ ] **Step 2: Run `node --test test/orchestrator.test.mjs` to verify it fails**
- [ ] **Step 3: Implement `src/adapters/index.mjs` and `src/orchestrator/engine.mjs`**
- [ ] **Step 4: Run `node --test test/orchestrator.test.mjs` and verify it passes**

---

### Task 5: Phone & Remote Chat Automation Agent (`ntfy.sh` Pub/Sub + OneDrive/Google Notes Inbox + Telegram + Mobile Endpoint)

**Files:**
- Create: `/home/aswath/agy-orchestrator/config/automation.json`
- Create: `/home/aswath/agy-orchestrator/src/automation/phone-bridge.mjs`
- Test: `/home/aswath/agy-orchestrator/test/phone-bridge.test.mjs`

**Interfaces:**
- Consumes: `OrchestratorEngine`
- Produces:
  - `PhoneAutomationBridge`: `start()`, `stop()`, `status()`, `updateConfig(patch)`, `processInboxFile(filePath)`, `sendPhoneNotification(title, message)`
  - Creates `/mnt/c/Users/aswat/OneDrive/Orch-Phone-Inbox.md` template so the user can immediately drop tasks from their phone.

- [ ] **Step 1: Write the failing test in `test/phone-bridge.test.mjs` testing atomic `- [ ]` -> `- [~]` -> `- [x]` markdown inbox execution and `ntfy` message parsing**
- [ ] **Step 2: Run `node --test test/phone-bridge.test.mjs` to verify it fails**
- [ ] **Step 3: Implement `config/automation.json` and `src/automation/phone-bridge.mjs`**
- [ ] **Step 4: Run `node --test test/phone-bridge.test.mjs` and verify it passes**

---

### Task 6: Tactical Telemetry Web Control Center (`src/ui/`) & Global CLI (`orch` / `orch.cmd`)

**Files:**
- Create: `/home/aswath/agy-orchestrator/src/ui/server.mjs`
- Create: `/home/aswath/agy-orchestrator/src/ui/index.html`
- Create: `/home/aswath/agy-orchestrator/bin/orch.mjs`
- Create: `/home/aswath/agy-orchestrator/bin/orch.cmd`
- Test: `/home/aswath/agy-orchestrator/test/ui-cli.test.mjs`

**Interfaces:**
- Consumes: All modules (`TopologyController`, `MemoryManager`, `TasteEngine`, `SkillRouter`, `LearningLoop`, `OrchestratorEngine`, `PhoneAutomationBridge`)
- Produces:
  - HTTP + SSE server (`http://127.0.0.1:4888`) with endpoints: `GET /api/state`, `GET /api/events`, `POST /api/topology`, `POST /api/run`, `POST /api/memory/search`, `POST /api/skills/route`, `POST /api/skills/install`, `POST /api/taste`, `POST /api/learn`, `POST /api/phone`, `POST /api/improvise`, `POST /api/theme`
  - Industrial Brutalist Tactical Telemetry UI (`index.html`) + Mobile Phone Command Drawer
  - Global symlinks `/home/aswath/.local/bin/orch` and `/mnt/c/Users/aswat/AppData/Roaming/npm/orch.cmd`

- [ ] **Step 1: Write the failing test in `test/ui-cli.test.mjs` testing REST API endpoints, SSE stream, and CLI commands (`orch status`, `orch set-leader`, `orch swap`, `orch route`, `orch memory`)**
- [ ] **Step 2: Run `node --test test/ui-cli.test.mjs` to verify it fails**
- [ ] **Step 3: Implement `src/ui/server.mjs`, `src/ui/index.html`, `bin/orch.mjs`, `bin/orch.cmd`, and link `orch` into PATH**
- [ ] **Step 4: Run full test suite `node --test test/*.test.mjs` and start the live `orch ui` + phone automation server to verify end-to-end operation**
