# ORCH® // AGY Multi-Surface & Dual-Category Agentic Coding Harness

> **Read the Full Technical Whitepaper:**
> - **Markdown Edition:** [`WHITEPAPER.md`](./WHITEPAPER.md)
> - **PDF Edition:** [`docs/WHITEPAPER.pdf`](./docs/WHITEPAPER.pdf)
> - **Engineering Decision Chronicle:** [`docs/interactions/session-ledger.md`](./docs/interactions/session-ledger.md)

**ORCH (`agy-orchestrator`)** is a zero-API-key, multi-surface command code orchestrator harness that coordinates **Google Antigravity WSL (`agy-wsl`)**, **Google Antigravity Windows (`agy-win`)**, **Command Code (`cmdc`)**, and **MiniMax Code (`mcode`)** across both **Category A (Gemini: `gemini-4-argon-*`, `gemini-3.8-flash-*`)** and **Category B (Claude / GPT: `claude-opus-5-5-*`, `claude-sonnet-5-5-*`, `gpt-oss-120b-medium`)** models.

---

## Core Architecture & Capabilities

1. **Dynamic Leader & Subagent Switching (Zero Static Lock-In)**
   - Promote any surface/model to **Main Leader** (`orch set-leader agy-win:gemini-4-argon-high` or `orch set-leader agy-wsl:claude-opus-5-5-high`) or swap the Leader with any subagent in one command (`orch swap gemini-architect`).
   - **Automatic EGM Goldfish Pairing**: Switching the Main Leader to a Gemini model automatically sets the fresh-context **Goldfish Critic** to Claude Opus 5.5 (and vice versa), eliminating single-family confirmation bias.

2. **3-Tier MemGPT + `claude-mem` Hybrid RRF Memory Engine**
   - Combines **SQLite FTS5 BM25** lexical search + **384-d `numpy` feature-hashed n-gram dense vectors** + **Ebbinghaus exponential time decay** via **Reciprocal Rank Fusion (RRF)**.
   - Bridges directly into your Windows `claude-mem.db` (**9,541+ observations**) via `file:...?immutable=1` to bypass WSL2 `9p` `fcntl` lock errors while keeping write-heavy `orch-mem.db` on native Linux `ext4`.

3. **Two-Stage Thinking Skill Router & Thompson Sampling Bandit**
   - Indexes **305 local skills** (`~/.agents/skills`, `~/.claude/skills`, `/mnt/c/Users/aswat/.claude/skills`, `egm`) in `<10ms` using BM25 + character trigram cosine RRF, with automatic missing-skill installation via `npx skills add` and local skill synthesis.
   - Uses a **Marsaglia-Tsang $\text{Beta}(\alpha, \beta)$ Thompson Sampling Multi-Armed Bandit** to route tasks across subagents while enforcing dual-category (Gemini + Claude/GPT) execution.

4. **User Taste Engine & Contrastive DPO Learning Loop**
   - Compiles your `[USER TASTE CONTRACT]` (`ponytail:ultra`, zero truncation/placeholders, `industrial-brutalist-ui`, git authorship preservation) into every agent prompt, scores outputs, updates Bandit posteriors online, and consolidates contrastive `(rejected, chosen, rootCause)` pairs into permanent rules.

5. **Bi-Directional Phone & Cloud Notes Automation Bridge**
   - Watches cloud-synced Markdown notes (`OneDrive/Orch-Phone-Inbox.md` & `memory/Phone-Inbox.md`) using an atomic 3-state machine (`- [ ]` → `- [~]` → `- [x]`), streams push commands/results via `ntfy.sh`, and controls `agy remote-control`.

6. **Tactical Telemetry Web Control Center (`http://127.0.0.1:4888`)**
   - Zero-build Node HTTP + Server-Sent Events (SSE) control plane engineered in `#0A0A0A` CRT carbon and `#E61919` aviation red telemetry styling (`Archivo Black` + `JetBrains Mono`), complete with a git-checkpointed **Self-Improvise Studio**.

---

## Quickstart & CLI Reference

```bash
# 1. Inspect current Leader, Subagent Pool, 188 Skills & Hybrid Memory stats
orch status

# 2. Switch Main Leader between WSL/Windows and Gemini/Claude/GPT
orch set-leader agy-win:gemini-4-argon-high --effort high
orch set-leader agy-wsl:claude-opus-5-5-high --effort high

# 3. Swap Main Leader with any Subagent Worker
orch swap gemini-architect
orch swap claude-coder

# 4. Preview Two-Stage Thinking Skill Router & Bandit Selection
orch route "Build an industrial brutalist telemetry dashboard with GSAP animations"

# 5. Execute Full Orchestrated Run (adaptive | full | egm | single)
orch run "Audit cross-OS path handling and write unit tests" --mode egm

# 6. Search or Add to 3-Tier Hybrid Memory (orch-mem + claude-mem)
orch memory search "sqlite wsl immutable"
orch memory add "Architecture Rule" "Always keep write-heavy SQLite WAL on native ext4."

# 7. Record Feedback into the Learning Loop & Taste Contract
orch learn "Never use generic 3-column cards; use 1px CSS blueprint grids."

# 8. Sync AGY CLI Theme across both WSL and Windows
orch theme "tokyo night"

# 9. Launch Tactical Telemetry Web Control Center + Phone Automation Daemon
orch ui --port 4888
```

---

## Quantitative Evaluations & Ablation Benchmarks (`orch eval`)

Reproduce all empirical ablations (Memory Retrieval, Skill Bandit Convergence, Cross-Category Topology, Taste Alignment, and Phone Concurrency Stress Tests) via:

```bash
orch eval
# or: npm run eval
```

Full benchmark report: [`eval/REPORT.md`](./eval/REPORT.md) | Raw metrics: [`eval/results.json`](./eval/results.json)

### 1. Memory Retrieval Ablation (3-Tier Hybrid RRF vs. Baselines)

| Retrieval Strategy | Recall@1 | Recall@3 | MRR | NDCG@3 | Avg Latency (ms) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Naive Substring JSON** | 14.3% | 14.3% | 0.143 | 0.143 | 0.11 ms |
| **Lexical FTS5 / BM25 Only** | 85.7% | 100.0% | 0.929 | 0.947 | 0.07 ms |
| **Dense 384-d N-Gram Only** | 85.7% | 100.0% | 0.929 | 0.947 | 0.17 ms |
| **ORCH Hybrid RRF + Ebbinghaus Decay** | **100.0%** | **100.0%** | **1.000** | **1.000** | **160.55 ms** |

### 2. Two-Stage Skill Router & Thompson Sampling Bandit (`N = 305` Skills)

| Metric | Zero-Shot Stage-1 RRF | Post-DPO Bandit (25 Rounds) | Naive Full-Index Injection |
| :--- | :---: | :---: | :---: |
| **Top-1 Skill Accuracy** | 66.7% | **100.0%** | N/A |
| **Top-3 Skill Recall** | 83.3% | **100.0%** | 100.0% |
| **Prompt Token Footprint** | **1,200 tokens** | **1,200 tokens** | 411,750 tokens |
| **Context Token Savings** | **99.71%** | **99.71%** | 0.0% |

### 3. Topology, Taste Classifier & Phone Atomic Concurrency

- **Cross-Family EGM Goldfish Pairing Invariant ($\text{Cat A} \leftrightarrow \text{Cat B}$)**: **`100.0%`** (`4/4` transitions verified)
- **Taste Anti-Truncation & Anti-Sycophancy Classifier**: **`100.0%` Precision | `100.0%` Recall | `1.000` F1**
- **Phone & Cloud Notes Concurrency Stress Test (`8` parallel workers over `3` unchecked tasks)**: **`0` duplicate executions (`100.0%` Atomic Lock Integrity)** in `49.02 ms`

---

## Verification Suite

Run the full zero-dependency test suite (`12/12` tests passing via `node:test`):

```bash
npm test
```
