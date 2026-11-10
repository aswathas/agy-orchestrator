import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_LEDGER_PATH = join(__dirname, '..', '..', 'learning', 'records.jsonl');
export const DEFAULT_BANDIT_PATH = join(__dirname, '..', '..', 'learning', 'bandit-state.json');

// Marsaglia & Tsang Gamma(a, 1) sampler for exact Beta(alpha, beta) Thompson Sampling
function sampleGamma(shape) {
  if (shape < 1) {
    const u = Math.max(1e-9, Math.random());
    return sampleGamma(shape + 1) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x = 0;
    let v = 0;
    do {
      const u1 = Math.max(1e-9, Math.random());
      const u2 = Math.random();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.max(1e-9, Math.random());
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function sampleBeta(alpha = 1.0, beta = 1.0) {
  const a = sampleGamma(Math.max(0.1, alpha));
  const b = sampleGamma(Math.max(0.1, beta));
  return a / (a + b + 1e-9);
}

export class LearningLoop {
  constructor({
    ledgerPath = DEFAULT_LEDGER_PATH,
    banditPath = DEFAULT_BANDIT_PATH,
    tasteEngine = null,
    memoryManager = null,
  } = {}) {
    this.ledgerPath = ledgerPath;
    this.banditPath = banditPath;
    this.tasteEngine = tasteEngine;
    this.memoryManager = memoryManager;
  }

  _loadBandit() {
    if (!existsSync(this.banditPath)) {
      return {
        version: 1,
        arms: {},
        skillRewards: {},
        updatedAt: new Date().toISOString(),
      };
    }
    return JSON.parse(readFileSync(this.banditPath, 'utf8'));
  }

  _saveBandit(state) {
    mkdirSync(dirname(this.banditPath), { recursive: true });
    state.updatedAt = new Date().toISOString();
    writeFileSync(this.banditPath, JSON.stringify(state, null, 2) + '\n', 'utf8');
    return state;
  }

  _appendLedger(entry) {
    mkdirSync(dirname(this.ledgerPath), { recursive: true });
    const record = {
      timestamp: new Date().toISOString(),
      ...entry,
    };
    appendFileSync(this.ledgerPath, JSON.stringify(record) + '\n', 'utf8');
    return record;
  }

  recordOutcome({
    task,
    agentId,
    surface,
    model,
    category,
    skills = [],
    success = true,
    latencyMs = 1000,
    tasteScore = 1.0,
    error = null,
    correction = null,
  }) {
    const state = this._loadBandit();
    const key = agentId || `${surface}:${model}`;
    if (!state.arms[key]) {
      state.arms[key] = {
        surface,
        model,
        category,
        alpha: 1.0,
        beta: 1.0,
        pulls: 0,
        avgLatencyMs: latencyMs,
      };
    }

    const arm = state.arms[key];
    // Composite reward r in [0, 1]: 60% success, 25% taste score, 15% latency efficiency (<30s)
    const latencyFactor = Math.max(0, Math.min(1, 1 - latencyMs / 60000));
    const reward = success
      ? 0.6 * 1.0 + 0.25 * tasteScore + 0.15 * latencyFactor
      : 0.05;

    arm.alpha = Number((arm.alpha + reward).toFixed(4));
    arm.beta = Number((arm.beta + (1 - reward)).toFixed(4));
    arm.pulls += 1;
    arm.avgLatencyMs = Math.round((arm.avgLatencyMs * (arm.pulls - 1) + latencyMs) / arm.pulls);

    for (const sk of skills) {
      if (!state.skillRewards[sk]) {
        state.skillRewards[sk] = { alpha: 1.0, beta: 1.0, uses: 0 };
      }
      state.skillRewards[sk].alpha = Number((state.skillRewards[sk].alpha + reward).toFixed(4));
      state.skillRewards[sk].beta = Number((state.skillRewards[sk].beta + (1 - reward)).toFixed(4));
      state.skillRewards[sk].uses += 1;
    }

    this._saveBandit(state);

    return this._appendLedger({
      type: 'outcome',
      task,
      agentId: key,
      surface,
      model,
      category,
      skills,
      success,
      latencyMs,
      tasteScore,
      reward: Number(reward.toFixed(4)),
      error,
      correction,
    });
  }

  recordContrastivePair({
    cluster,
    rejected,
    chosen,
    rootCause,
    utility = 0.9,
  }) {
    return this._appendLedger({
      type: 'contrastive_dpo',
      cluster,
      rejected,
      chosen,
      rootCause,
      utility: Number(utility),
      consolidated: false,
    });
  }

  getLedgerEntries(limit = 50) {
    if (!existsSync(this.ledgerPath)) return [];
    const lines = readFileSync(this.ledgerPath, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  consolidateRules() {
    const entries = this.getLedgerEntries(200);
    const promotedRules = [];

    for (const entry of entries) {
      if (entry.type === 'contrastive_dpo' && Number(entry.utility) >= 0.8) {
        const ruleText = `[${entry.cluster}] Prefer: ${entry.chosen} (Avoid: ${entry.rejected} — Reason: ${entry.rootCause})`;
        promotedRules.push(ruleText);
        if (this.tasteEngine) {
          this.tasteEngine.addRule(ruleText);
        }
      } else if (entry.type === 'outcome' && entry.correction) {
        const ruleText = `[User Correction] ${entry.correction}`;
        promotedRules.push(ruleText);
        if (this.tasteEngine) {
          this.tasteEngine.addRule(ruleText);
        }
      }
    }

    return {
      ok: true,
      promotedCount: promotedRules.length,
      promotedRules,
    };
  }

  getBanditStats() {
    const state = this._loadBandit();
    const summaries = {};
    for (const [k, arm] of Object.entries(state.arms)) {
      const mean = arm.alpha / (arm.alpha + arm.beta);
      summaries[k] = {
        ...arm,
        expectedReward: Number(mean.toFixed(4)),
        sampledTheta: Number(sampleBeta(arm.alpha, arm.beta).toFixed(4)),
      };
    }
    return {
      updatedAt: state.updatedAt,
      arms: summaries,
      skillRewards: state.skillRewards,
      recentRecords: this.getLedgerEntries(15),
    };
  }
}
