import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { sampleBeta } from '../learning/loop.mjs';

const execFileAsync = promisify(execFile);

export const SKILL_DIRS = [
  '/home/aswath/.agents/skills',
  '/home/aswath/.claude/skills',
  '/mnt/c/Users/aswat/.claude/skills',
  '/mnt/c/Users/aswat/.claude/plugins/marketplaces/egm/skills',
];

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function charTrigrams(text) {
  const s = `^${String(text || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 400)}$`;
  const map = new Map();
  for (let i = 0; i <= s.length - 3; i++) {
    const tg = s.slice(i, i + 3);
    map.set(tg, (map.get(tg) || 0) + 1);
  }
  return map;
}

function trigramCosine(mapA, mapB) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [, v] of mapA) normA += v * v;
  for (const [, v] of mapB) normB += v * v;
  if (normA === 0 || normB === 0) return 0;
  for (const [k, vA] of mapA) {
    const vB = mapB.get(k);
    if (vB) dot += vA * vB;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function parseSkillMd(filePath, folderName) {
  const raw = readFileSync(filePath, 'utf8');
  let name = folderName;
  let description = '';
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    const fm = fmMatch[1];
    const nMatch = fm.match(/^name:\s*(.+)$/m);
    if (nMatch) name = nMatch[1].trim().replace(/^["']|["']$/g, '');
    const dMatch = fm.match(/^description:\s*>?\s*([\s\S]*?)(?:^[a-zA-Z0-9_-]+:|\z)/m);
    if (dMatch) {
      description = dMatch[1].replace(/\s+/g, ' ').trim().replace(/^["']|["']$/g, '');
    }
  }
  if (!description) {
    description = raw.slice(0, 300).replace(/\s+/g, ' ').trim();
  }
  const combined = `${name} ${folderName} ${description}`;
  return {
    name,
    folderName,
    path: filePath,
    description,
    tokens: tokenize(combined),
    trigrams: charTrigrams(combined),
  };
}

export class SkillRouter {
  constructor({ skillDirs = SKILL_DIRS, learningLoop = null } = {}) {
    this.skillDirs = skillDirs;
    this.learningLoop = learningLoop;
    this.catalog = [];
    this.df = new Map();
  }

  indexLocalSkills() {
    const seen = new Map();
    for (const root of this.skillDirs) {
      if (!existsSync(root)) continue;
      let entries = [];
      try {
        entries = readdirSync(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const skillFile = join(root, entry.name, 'SKILL.md');
        if (!existsSync(skillFile)) continue;
        if (seen.has(entry.name)) continue;
        try {
          const parsed = parseSkillMd(skillFile, entry.name);
          seen.set(entry.name, parsed);
        } catch {
          // ignore malformed skill file
        }
      }
    }

    this.catalog = Array.from(seen.values());
    this.df.clear();
    for (const item of this.catalog) {
      const uniq = new Set(item.tokens);
      for (const tok of uniq) {
        this.df.set(tok, (this.df.get(tok) || 0) + 1);
      }
    }
    return {
      count: this.catalog.length,
      skills: this.catalog.map((s) => ({ name: s.name, path: s.path, description: s.description })),
    };
  }

  extractTaskFeatures(prompt) {
    const p = String(prompt || '').toLowerCase();
    const features = {
      architecture: /\b(architect|design|spec|schema|system|plan|orchestrat|structure|module)\b/.test(p) ? 1 : 0,
      implementation: /\b(build|create|write|implement|code|add|feature|endpoint|cli|script)\b/.test(p) ? 1 : 0,
      debugging: /\b(bug|fix|error|fail|crash|debug|issue|broken|trace)\b/.test(p) ? 1 : 0,
      frontend_ui: /\b(ui|ux|frontend|dashboard|css|grid|gsap|framer|animation|brutalist|web|html|theme)\b/.test(p) ? 1 : 0,
      windows_os: /\b(windows|win|cmd\.exe|powershell|onedrive|c:\\|wsl)\b/.test(p) ? 1 : 0,
      wsl_linux: /\b(wsl|linux|ubuntu|bash|systemd|daemon|posix)\b/.test(p) ? 1 : 0,
      research: /\b(research|investigate|compare|study|enlighten|audit|review|grill|egm)\b/.test(p) ? 1 : 0,
      refactor: /\b(refactor|simplify|clean|ponytail|optimize|perf)\b/.test(p) ? 1 : 0,
    };

    const wordCount = p.split(/\s+/).filter(Boolean).length;
    const activeDims = Object.values(features).reduce((a, b) => a + b, 0);
    const complexityScore = Number(
      Math.min(1.0, activeDims * 0.16 + Math.min(0.4, wordCount / 60)).toFixed(2)
    );

    return { features, activeDims, wordCount, complexityScore };
  }

  routeTask(prompt, { topology = null, maxSkills = 4 } = {}) {
    if (this.catalog.length === 0) {
      this.indexLocalSkills();
    }

    const qTokens = tokenize(prompt);
    const qTrigrams = charTrigrams(prompt);
    const N = Math.max(1, this.catalog.length);
    const banditStats = this.learningLoop ? this.learningLoop.getBanditStats() : { arms: {}, skillRewards: {} };

    // Compute BM25 + Trigram Dense Vector Cosine + Bandit Skill Prior
    const bm25Scores = [];
    const vecScores = [];

    for (let idx = 0; idx < this.catalog.length; idx++) {
      const skill = this.catalog[idx];
      const tfMap = new Map();
      for (const t of skill.tokens) tfMap.set(t, (tfMap.get(t) || 0) + 1);
      const docLen = Math.max(1, skill.tokens.length);
      let bm25 = 0;

      for (const qt of qTokens) {
        let tf = tfMap.get(qt) || 0;
        // Exact substring match in skill name gets strong boost
        if (skill.name.toLowerCase().includes(qt) || skill.folderName.toLowerCase().includes(qt)) {
          tf += 4;
        }
        if (tf > 0) {
          const df = this.df.get(qt) || 1;
          const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
          const k1 = 1.5;
          const b = 0.75;
          bm25 += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / 45))));
        }
      }

      const cosSim = trigramCosine(qTrigrams, skill.trigrams);
      bm25Scores.push({ idx, bm25 });
      vecScores.push({ idx, cosSim });
    }

    bm25Scores.sort((a, b) => b.bm25 - a.bm25);
    vecScores.sort((a, b) => b.cosSim - a.cosSim);

    const bm25Rank = new Map();
    const vecRank = new Map();
    bm25Scores.forEach((x, r) => bm25Rank.set(x.idx, { rank: r + 1, score: x.bm25 }));
    vecScores.forEach((x, r) => vecRank.set(x.idx, { rank: r + 1, score: x.cosSim }));

    const rrfRanked = this.catalog.map((skill, idx) => {
      const b = bm25Rank.get(idx);
      const v = vecRank.get(idx);
      const lexRrf = b.score > 0 ? 0.55 / (20 + b.rank) : 0;
      const vecRrf = 0.45 / (20 + v.rank) * Math.max(0.05, v.score);
      const skReward = banditStats.skillRewards?.[skill.name] || banditStats.skillRewards?.[skill.folderName];
      const posteriorMean = skReward ? skReward.alpha / (skReward.alpha + skReward.beta) : 0.5;
      const uses = skReward?.uses || 0;
      const confidenceScale = Math.min(1.0, uses / 4);
      const banditBoost = skReward
        ? 0.75 + (0.65 + 0.6 * confidenceScale) * posteriorMean
        : 1.0;
      const finalScore = (lexRrf + vecRrf) * banditBoost;

      return {
        name: skill.name,
        folderName: skill.folderName,
        path: skill.path,
        description: skill.description.slice(0, 220),
        bm25Score: Number(b.score.toFixed(3)),
        cosineSim: Number(v.score.toFixed(3)),
        rrfScore: Number(finalScore.toFixed(5)),
      };
    });

    rrfRanked.sort((a, b) => b.rrfScore - a.rrfScore);
    const selectedSkills = rrfRanked.slice(0, maxSkills);
    const topScore = selectedSkills[0]?.rrfScore || 0;
    const needsSkillInstall = topScore < 0.008;

    const { features, complexityScore } = this.extractTaskFeatures(prompt);
    const agentPlan = this.selectAgentsBandit(features, complexityScore, topology, banditStats);

    return {
      complexityScore,
      features,
      selectedSkills,
      needsSkillInstall,
      agentPlan,
    };
  }

  selectAgentsBandit(features, complexityScore, topology, banditStats = { arms: {} }) {
    const topo = topology || {
      leader: {
        id: 'leader-main',
        surface: 'agy-wsl',
        category: 'claude-gpt',
        model: 'claude-opus-5-5-high',
        effort: 'high',
      },
      goldfishCritic: {
        id: 'goldfish-critic',
        surface: 'agy-wsl',
        category: 'gemini',
        model: 'gemini-4-argon-high',
        effort: 'high',
      },
      subagents: {},
      policies: { requireBothModelCategories: true, complexityGateThreshold: 0.4 },
    };

    const leader = topo.leader;
    const subEntries = Object.entries(topo.subagents || {}).map(([id, w]) => {
      const arm = banditStats.arms?.[id] || { alpha: 1.5, beta: 1.0 };
      const theta = sampleBeta(arm.alpha, arm.beta);
      let specialtyMatch = 0;
      for (const sp of w.specialties || []) {
        const norm = sp.replace(/-/g, '_');
        if (features[norm]) specialtyMatch += 0.35;
        if (sp === 'implementation' && features.implementation) specialtyMatch += 0.35;
        if (sp === 'architecture' && features.architecture) specialtyMatch += 0.35;
        if (sp === 'deep-reasoning' && (features.research || features.architecture)) specialtyMatch += 0.3;
      }
      const totalScore = Number((theta * 0.6 + specialtyMatch * 0.4).toFixed(4));
      return {
        id,
        ...w,
        banditTheta: Number(theta.toFixed(4)),
        specialtyMatch: Number(specialtyMatch.toFixed(4)),
        score: totalScore,
      };
    });

    subEntries.sort((a, b) => b.score - a.score);

    const threshold = topo.policies?.complexityGateThreshold ?? 0.4;
    const isComplex = complexityScore >= threshold;

    const selectedWorkers = [];
    if (subEntries.length > 0) {
      selectedWorkers.push(subEntries[0]);
    }

    // Enforce Dual-Category (Gemini + Claude/GPT) participation
    const currentCategories = new Set([leader.category, ...selectedWorkers.map((w) => w.category)]);
    const missingCategory = !currentCategories.has('gemini')
      ? 'gemini'
      : !currentCategories.has('claude-gpt')
      ? 'claude-gpt'
      : null;

    if (missingCategory) {
      const candidate = subEntries.find(
        (w) => w.category === missingCategory && !selectedWorkers.some((s) => s.id === w.id)
      );
      if (candidate) {
        selectedWorkers.push(candidate);
      }
    } else if (isComplex && subEntries.length > 1 && selectedWorkers.length < 2) {
      selectedWorkers.push(subEntries[1]);
    }

    return {
      mode: isComplex ? 'multi-agent-dual-category' : 'fast-track',
      leader,
      goldfishCritic: topo.goldfishCritic,
      selectedWorkers,
      allRankedWorkers: subEntries,
    };
  }

  loadSkillInstructions(skillItem, maxChars = 2500) {
    try {
      const content = readFileSync(skillItem.path, 'utf8');
      return `### SKILL: ${skillItem.name}\n${content.slice(0, maxChars)}`;
    } catch {
      return '';
    }
  }

  async installMissingSkill(queryOrPackage) {
    try {
      const { stdout, stderr } = await execFileAsync(
        'npx',
        ['--yes', 'skills', 'add', queryOrPackage, '-g', '-y'],
        { timeout: 60000 }
      );
      this.indexLocalSkills();
      return { ok: true, output: stdout || stderr };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  synthesizeSkill({ name, description, instructions }) {
    const slug = String(name)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-|-$/g, '');
    const targetDir = join('/home/aswath/.agents/skills', slug);
    mkdirSync(targetDir, { recursive: true });
    const skillPath = join(targetDir, 'SKILL.md');
    const body = `---\nname: ${slug}\ndescription: ${description}\n---\n\n# ${name}\n\n${instructions}\n`;
    writeFileSync(skillPath, body, 'utf8');
    this.indexLocalSkills();
    return { ok: true, name: slug, path: skillPath };
  }
}
