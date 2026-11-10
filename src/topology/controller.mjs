import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_TOPOLOGY_PATH = join(__dirname, '..', '..', 'config', 'topology.json');

export const AGY_MODEL_CATALOG = {
  gemini: [
    { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High)', category: 'gemini' },
    { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)', category: 'gemini' },
    { id: 'gemini-4-argon-low', label: 'Gemini 4 Argon (Low)', category: 'gemini' },
    { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', category: 'gemini' },
    { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)', category: 'gemini' },
    { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)', category: 'gemini' },
  ],
  'claude-gpt': [
    { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High)', category: 'claude-gpt' },
    { id: 'claude-opus-5-5-medium', label: 'Claude Opus 5.5 (Medium)', category: 'claude-gpt' },
    { id: 'claude-opus-5-5-low', label: 'Claude Opus 5.5 (Low)', category: 'claude-gpt' },
    { id: 'claude-sonnet-5-5-high', label: 'Claude Sonnet 5.5 (High)', category: 'claude-gpt' },
    { id: 'claude-sonnet-5-5-medium', label: 'Claude Sonnet 5.5 (Medium)', category: 'claude-gpt' },
    { id: 'claude-sonnet-5-5-low', label: 'Claude Sonnet 5.5 (Low)', category: 'claude-gpt' },
    { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)', category: 'claude-gpt' },
  ],
};

export const VALID_SURFACES = ['agy-wsl', 'agy-win', 'cmdc', 'mcode'];

export function inferCategory(surface, model) {
  const m = String(model || '').toLowerCase();
  if (m.startsWith('gemini')) return 'gemini';
  if (m.startsWith('claude') || m.startsWith('gpt')) return 'claude-gpt';
  if (surface === 'cmdc') return 'taste';
  return 'external-cli';
}

export function parseAgentSpec(spec) {
  const raw = String(spec || '').trim();
  const idx = raw.indexOf(':');
  if (idx === -1) {
    // Only model or only surface provided
    if (VALID_SURFACES.includes(raw)) {
      return {
        surface: raw,
        model: raw.startsWith('agy') ? 'gemini-4-argon-medium' : 'default',
        category: inferCategory(raw, raw.startsWith('agy') ? 'gemini-4-argon-medium' : 'default'),
      };
    }
    return {
      surface: 'agy-wsl',
      model: raw,
      category: inferCategory('agy-wsl', raw),
    };
  }
  const surface = raw.slice(0, idx).trim();
  const model = raw.slice(idx + 1).trim() || 'default';
  if (!VALID_SURFACES.includes(surface)) {
    throw new Error(`Invalid surface "${surface}". Valid surfaces: ${VALID_SURFACES.join(', ')}`);
  }
  return {
    surface,
    model,
    category: inferCategory(surface, model),
  };
}

export function defaultTopology() {
  return {
    version: 2,
    activeSessionId: 'default',
    leader: {
      id: 'leader-main',
      surface: 'agy-wsl',
      category: 'claude-gpt',
      model: 'claude-opus-5-5-high',
      effort: 'high',
      role: 'Main Architect & Elephant Coordinator',
    },
    router: {
      id: 'thinking-router',
      surface: 'agy-wsl',
      category: 'gemini',
      model: 'gemini-3.8-flash-high',
      effort: 'medium',
      role: 'Two-Stage Thinking Skill Router & Bandit Selector',
    },
    goldfishCritic: {
      id: 'goldfish-critic',
      surface: 'agy-wsl',
      category: 'gemini',
      model: 'gemini-4-argon-high',
      effort: 'high',
      role: 'Fresh-Context EGM Goldfish Reviewer',
    },
    tasteCritic: {
      id: 'taste-critic',
      surface: 'cmdc',
      category: 'taste',
      model: 'default',
      effort: 'medium',
      role: 'User Taste & Ponytail Quality Gate',
    },
    subagents: {
      'gemini-architect': {
        surface: 'agy-wsl',
        category: 'gemini',
        model: 'gemini-4-argon-high',
        effort: 'high',
        specialties: ['architecture', 'deep-reasoning', 'research', 'frontend_ui'],
      },
      'win-gemini-worker': {
        surface: 'agy-win',
        category: 'gemini',
        model: 'gemini-3.8-flash-medium',
        effort: 'medium',
        specialties: ['windows_os', 'fast-coding', 'validation'],
      },
      'claude-coder': {
        surface: 'agy-wsl',
        category: 'claude-gpt',
        model: 'claude-sonnet-5-5-high',
        effort: 'high',
        specialties: ['implementation', 'refactoring', 'debugging', 'wsl_linux'],
      },
      'gpt-worker': {
        surface: 'agy-win',
        category: 'claude-gpt',
        model: 'gpt-oss-120b-medium',
        effort: 'medium',
        specialties: ['alternative-implementation', 'code-review', 'windows_os'],
      },
      'cmdc-worker': {
        surface: 'cmdc',
        category: 'external-cli',
        model: 'default',
        effort: 'medium',
        specialties: ['taste', 'implementation', 'refactor'],
      },
      'mcode-fast': {
        surface: 'mcode',
        category: 'external-cli',
        model: 'default',
        effort: 'medium',
        specialties: ['quick-edits', 'boilerplate'],
      },
    },
    policies: {
      requireBothModelCategories: true,
      complexityGateThreshold: 0.4,
      defaultExecutionMode: 'adaptive',
      autoInstallMissingSkills: true,
      maxSubagentConcurrency: 3,
      enableLearningLoop: true,
      enableTasteInjection: true,
    },
  };
}

export class TopologyController {
  constructor(configPath = DEFAULT_TOPOLOGY_PATH) {
    this.configPath = configPath;
  }

  load() {
    if (!existsSync(this.configPath)) {
      const d = defaultTopology();
      this.save(d);
      return d;
    }
    return JSON.parse(readFileSync(this.configPath, 'utf8'));
  }

  save(topology) {
    mkdirSync(dirname(this.configPath), { recursive: true });
    topology.updatedAt = new Date().toISOString();
    writeFileSync(this.configPath, JSON.stringify(topology, null, 2) + '\n', 'utf8');
    return topology;
  }

  setLeader(spec, opts = {}) {
    const topo = this.load();
    const parsed = typeof spec === 'string' ? parseAgentSpec(spec) : spec;
    topo.leader = {
      ...topo.leader,
      surface: parsed.surface,
      model: parsed.model,
      category: parsed.category || inferCategory(parsed.surface, parsed.model),
      effort: opts.effort || parsed.effort || topo.leader.effort || 'high',
      role: opts.role || topo.leader.role,
    };
    // Automatically align Goldfish critic to the opposite model category!
    if (topo.leader.category === 'gemini') {
      topo.goldfishCritic = {
        ...topo.goldfishCritic,
        surface: 'agy-wsl',
        category: 'claude-gpt',
        model: 'claude-opus-5-5-high',
      };
    } else if (topo.leader.category === 'claude-gpt') {
      topo.goldfishCritic = {
        ...topo.goldfishCritic,
        surface: 'agy-wsl',
        category: 'gemini',
        model: 'gemini-4-argon-high',
      };
    }
    return this.save(topo);
  }

  setRole(roleKey, spec, opts = {}) {
    if (roleKey === 'leader') return this.setLeader(spec, opts);
    const topo = this.load();
    if (!['router', 'goldfishCritic', 'tasteCritic'].includes(roleKey)) {
      throw new Error(`Unknown role "${roleKey}". Valid: leader, router, goldfishCritic, tasteCritic`);
    }
    const parsed = typeof spec === 'string' ? parseAgentSpec(spec) : spec;
    topo[roleKey] = {
      ...topo[roleKey],
      surface: parsed.surface,
      model: parsed.model,
      category: parsed.category || inferCategory(parsed.surface, parsed.model),
      effort: opts.effort || parsed.effort || topo[roleKey]?.effort || 'medium',
    };
    return this.save(topo);
  }

  swapLeaderWithSubagent(subId) {
    const topo = this.load();
    const sub = topo.subagents[subId];
    if (!sub) {
      throw new Error(`Subagent "${subId}" not found in roster: ${Object.keys(topo.subagents).join(', ')}`);
    }
    const prevLeader = { ...topo.leader };
    topo.leader = {
      id: 'leader-main',
      surface: sub.surface,
      category: sub.category || inferCategory(sub.surface, sub.model),
      model: sub.model,
      effort: sub.effort || 'high',
      role: prevLeader.role,
    };
    topo.subagents[subId] = {
      ...sub,
      surface: prevLeader.surface,
      category: prevLeader.category,
      model: prevLeader.model,
      effort: prevLeader.effort || 'high',
    };
    return this.save(topo);
  }

  upsertWorker(id, spec, opts = {}) {
    const topo = this.load();
    const parsed = typeof spec === 'string' ? parseAgentSpec(spec) : spec;
    const existing = topo.subagents[id] || {};
    topo.subagents[id] = {
      ...existing,
      surface: parsed.surface,
      model: parsed.model,
      category: parsed.category || inferCategory(parsed.surface, parsed.model),
      effort: opts.effort || parsed.effort || existing.effort || 'medium',
      specialties: opts.specialties || existing.specialties || ['general'],
    };
    return this.save(topo);
  }

  removeWorker(id) {
    const topo = this.load();
    delete topo.subagents[id];
    return this.save(topo);
  }

  updatePolicies(patch) {
    const topo = this.load();
    topo.policies = { ...topo.policies, ...patch };
    return this.save(topo);
  }
}
