# ORCH v2.0 — Quantitative Evaluation & Ablation Report

- **Generated At**: `2026-11-10T08:32:05.533Z`
- **Total Suite Runtime**: `5706.24 ms`

## 1. Memory Retrieval Ablation (3-Tier Hybrid RRF vs. Baselines)

| Retrieval Strategy | Recall@1 | Recall@3 | MRR | NDCG@3 | Avg Latency (ms) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Naive Substring JSON** | 14.3% | 14.3% | 0.143 | 0.143 | 0.08 ms |
| **Lexical FTS5 / BM25 Only** | 85.7% | 100.0% | 0.929 | 0.947 | 0.09 ms |
| **Dense 384-d N-Gram Only** | 85.7% | 100.0% | 0.929 | 0.947 | 0.28 ms |
| **ORCH Hybrid RRF + Ebbinghaus Decay** | **100.0%** | **100.0%** | **1.000** | **1.000** | **219.59 ms** |

- **Live Cross-OS Windows `claude-mem.db` (9,541 observations) Query Latency**: `343.81 ms` (`1` cross-OS hits fused).

## 2. Two-Stage Skill Router & Thompson Sampling Bandit (`N = 305` Skills)

| Metric | Zero-Shot Stage-1 RRF | Post-DPO Bandit (25 Rounds) | Naive Full-Index Injection |
| :--- | :---: | :---: | :---: |
| **Top-1 Skill Accuracy** | 66.7% | **100.0%** | N/A |
| **Top-3 Skill Recall** | 83.3% | **100.0%** | 100.0% |
| **Prompt Token Footprint** | **1,200 tokens** | **1,200 tokens** | 411,750 tokens |
| **Context Token Savings** | **99.71%** | **99.71%** | 0.0% |

### Bandit Cumulative Regret Curve (25 Rounds)

| Round ($T$) | Cumulative Regret ($R_T$) | Avg Regret / Round ($R_T / T$) |
| :---: | :---: | :---: |
| 1 | 0.020 | 0.0200 |
| 5 | 1.020 | 0.2040 |
| 10 | 1.120 | 0.1120 |
| 15 | 1.220 | 0.0813 |
| 20 | 1.320 | 0.0660 |
| 25 | 1.420 | 0.0568 |

## 3. Dual-Category Adversarial Topology & Taste Alignment

- **Cross-Family Goldfish Pairing Invariant (Cat A $\leftrightarrow$ Cat B)**: `100.0%` (4/4 transitions verified)
- **Taste Anti-Truncation & Alignment Classifier**: Precision `100.0%` | Recall `100.0%` | F1 `1.000` | Accuracy `100.0%`

## 4. Phone & Cloud Notes Atomic Concurrency Stress Test

- **Concurrent Polls Fired**: `8` parallel workers over `3` unchecked tasks
- **Duplicate Executions**: `0` (**100% Atomic Lock Integrity**)
- **Total Stress Runtime**: `48.83 ms`
