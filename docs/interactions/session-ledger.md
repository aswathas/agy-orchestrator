# Aswath Chronicle — Engineering Decision & Interaction Ledger

Granular step-by-step audit trail of architectural decisions, user prompts, failure recoveries, and atomic git commits for `agy-orchestrator` (`ORCH`).

---

## [Step 01] Foundation & Dual-Environment Discovery (`agy-wsl`, `agy-win`, `cmdc`, `mcode`)

- **User Prompt / Trigger**: *"Write and create command code orchestrator small harness for controlling agy windows, agy wsl, agy has 2 categories of model one is gemini models other is gpt / claude models... dynamic leader/subagents... can I use my current agy or cmdc or mcode agents as brain I can't afford API keys"*
- **Architectural Decision**: Use zero paid external API keys. Wrap authenticated local CLI binaries (`/home/aswath/.local/bin/agy`, `C:\Users\aswat\AppData\Local\agy\bin\agy.exe`, `cmdc`, `mcode`) behind a unified `runBrain()` adapter.
- **Failure Discovery & Pivot**: Spawning `cmd.exe /c agy.exe` from a WSL directory (`\\wsl.localhost\Ubuntu\...`) caused `cmd.exe` to reject the UNC path and mangle multi-line prompts. Pivoted to writing UTF-8 prompt payloads into `/mnt/c/Users/aswat/.agy-orch-bridge` and reading them via `powershell.exe -NoProfile -Command "$p = Get-Content -Raw ..."` with `cwd: C:\Users\aswat`.
- **Implementation Action**: Created `src/adapters/path-bridge.mjs` and `src/adapters/index.mjs`.

---

## [Step 02] AGY CLI Theme Synchronization (`colorScheme`)

- **User Prompt / Trigger**: *"I want to change the theme of this CLI agy first before decision"*
- **Architectural Decision**: Extracted the 8 valid `colorScheme` constants directly from the `agy` ELF binary (`tokyo night`, `solarized dark`, `dark`, `colorblind-friendly dark`, `terminal`, `light`, `solarized light`, `colorblind-friendly light`), updated WSL `~/.gemini/antigravity-cli/settings.json` to `"tokyo night"`, and built `orch theme <scheme>` to keep WSL and Windows themes synchronized.
- **Implementation Action**: Implemented `getAgyThemesStatus()` and `setAgyTheme()` in `src/adapters/path-bridge.mjs`.

---

## [Step 03] Live-Swappable Topology & Automatic EGM Goldfish Pairing

- **User Prompt / Trigger**: *"I don't want static orchestrator settings, I should have controls to switch who is the main leader / subagents, I will need to tweak this one... grill the whole plan use /egm skills"*
- **Architectural Decision**: Store topology in hot-reloaded `config/topology.json`. Whenever the Main Leader (`leader`) is changed (`orch set-leader` or `orch swap`), automatically align `goldfishCritic` to the *opposite* foundation model category (`gemini` <-> `claude-gpt`) so fresh-context EGM reviews never share family bias.
- **Implementation Action**: Created `config/topology.json`, `src/topology/controller.mjs`, and `test/topology.test.mjs`.

---

## [Step 04] 3-Tier MemGPT + `claude-mem.db` Hybrid RRF Memory Engine

- **User Prompt / Trigger**: *"I want a better memory like claude-mem like memory... use /ponytail [ultra] enlighten me simple memory json won't work ik"*
- **Architectural Decision**: Replace flat JSON memory with a 3-Tier MemGPT architecture backed by Python `sqlite3` FTS5 BM25 + 384-d `numpy` feature-hashed n-gram dense vectors + Reciprocal Rank Fusion (RRF) + Ebbinghaus temporal decay, bridged directly to `/mnt/c/Users/aswat/.claude-mem/claude-mem.db` (9,541 observations).
- **Failure Discovery & Pivot**: Opening `/mnt/c/Users/aswat/.claude-mem/claude-mem.db` from WSL threw `sqlite3.OperationalError: disk I/O error` because WSL2's `9p` mount fails `fcntl` shared-memory locks on Windows WAL `-shm` files. Pivoted to keeping write-heavy `orch-mem.db` on native Linux `ext4` while querying `claude-mem.db` via `file:/mnt/c/Users/aswat/.claude-mem/claude-mem.db?immutable=1`.
- **Implementation Action**: Created `src/memory/hybrid_engine.py`, `src/memory/manager.mjs`, `taste/taste-profile.json`, `src/taste/engine.mjs`, and `test/memory-taste.test.mjs`.

---

## [Step 05] Two-Stage Thinking Skill Router, Thompson Sampling Bandit & DPO Learning Loop

- **User Prompt / Trigger**: *"Better thinking router to load all needed skill (this router should load or download the skill as per need)... follow best method in research like ML models or deep learning models wherever needed"*
- **Architectural Decision**: Built a sub-10ms local hybrid router indexing all 188 skills across `~/.agents/skills`, `~/.claude/skills`, and `egm` using BM25 + character trigram cosine RRF, paired with a Marsaglia-Tsang $\text{Beta}(\alpha, \beta)$ Thompson Sampling Contextual Bandit and DPO contrastive rule consolidation.
- **Implementation Action**: Created `src/router/skill-router.mjs`, `src/learning/loop.mjs`, and `test/router-learning.test.mjs`.

---

## [Step 06] Multi-Agent Orchestrator Engine & Bi-Directional Phone Automation Bridge

- **User Prompt / Trigger**: *"We need few more additions like automation agent, I need channel in this to communicate with me through phone either way using Google Notes or any forwarding chatting I can do with so this listens to that automates my work"*
- **Architectural Decision**: Built `PhoneAutomationBridge` watching `/mnt/c/Users/aswat/OneDrive/Orch-Phone-Inbox.md` using an atomic 3-state Markdown transition (`- [ ]` -> `- [~]` -> `- [x]`) so file-watcher ticks never duplicate runs, plus `ntfy.sh` pub/sub streaming and `agy remote-control`.
- **Implementation Action**: Created `src/orchestrator/engine.mjs`, `config/automation.json`, `src/automation/phone-bridge.mjs`, `test/orchestrator.test.mjs`, and `test/phone-bridge.test.mjs`.

---

## [Step 07] Tactical Telemetry Web Control Center (`industrial-brutalist-ui`) & Self-Improviser

- **User Prompt / Trigger**: *"I need a UI for me to change settings easily... rich UI you need to use the best UI UX skills and make this... I can improvise this add new feature or I can see what are the tasks who doing"*
- **Architectural Decision**: Built a zero-build `node:http` + Server-Sent Events (SSE) control server on port `4888` styled strictly to `industrial-brutalist-ui` Archetype 2.2 (`#0A0A0A` CRT carbon, `#EAEAEA` phosphor, `#E61919` aviation red, `0px` radius, `1px` CSS grid, `Archivo Black` + `JetBrains Mono`) with git-checkpointed autonomous self-evolution (`improviseSelf`).
- **Implementation Action**: Created `src/ui/server.mjs`, `src/ui/index.html`, `bin/orch.mjs`, `bin/orch.cmd`, and `test/ui-cli.test.mjs`.

---

## [Step 08] Technical Whitepaper, PDF Generation & Step-by-Step Git Chronicle

- **User Prompt / Trigger**: *"Write a white paper for this and this should be detailed covering from what is a harness and every part of it breakdown to smallest things so that by reading one whole pdf or docs people can understand what we build and publish this in github also remember our /aswath-commit (commit step by step, decision by decision)"*
- **Architectural Decision**: Authored `WHITEPAPER.md`, rendered `docs/WHITEPAPER.pdf` via PyMuPDF (`fitz.Story`), recorded the full decision trail in `docs/interactions/session-ledger.md`, structured the repository into 8 atomic, chronological commits per `aswath-chronicle`, and published to GitHub under `aswathas`.
- **Implementation Action**: Created `WHITEPAPER.md`, `README.md`, `tools/chronicle.py`, `tools/build_whitepaper_pdf.py`, and `docs/WHITEPAPER.pdf`.
