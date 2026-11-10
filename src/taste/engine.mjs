import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_TASTE_PATH = join(__dirname, '..', '..', 'taste', 'taste-profile.json');

export function defaultTasteProfile() {
  return {
    version: 2,
    user: 'aswath',
    coding: {
      ponytailLevel: 'ultra',
      banTruncationAndPlaceholders: true,
      preferStandardLibrary: true,
      preserveGitAuthor: {
        enabled: true,
        name: 'aswath',
        email: 'aswath@users.noreply.github.com',
      },
    },
    ui: {
      archetype: 'industrial-brutalist-tactical-telemetry',
      designVariance: 8,
      motionIntensity: 6,
      visualDensity: 8,
      substrate: '#0A0A0A',
      foreground: '#EAEAEA',
      accent: '#E61919',
      statusGreen: '#4AF626',
      banEmojisInUI: true,
      banInterAndPurpleGlows: true,
      strictZeroBorderRadius: true,
    },
    communication: {
      style: 'egm-plain-english',
      critiqueFirst: true,
      banSycophancy: true,
    },
    customRules: [
      'Always use ?immutable=1 when reading SQLite WAL databases across WSL2 /mnt/c 9p mounts.',
      'Run Windows CLI tools (agy.exe, cmdc.cmd) with a valid Windows working directory (C:\\Users\\aswat), never a raw \\\\wsl.localhost UNC CWD.',
      'Never leave TODO/TBD placeholders or truncated code blocks.',
    ],
  };
}

export class TasteEngine {
  constructor(profilePath = DEFAULT_TASTE_PATH) {
    this.profilePath = profilePath;
  }

  loadProfile() {
    if (!existsSync(this.profilePath)) {
      const def = defaultTasteProfile();
      this.saveProfile(def);
      return def;
    }
    return JSON.parse(readFileSync(this.profilePath, 'utf8'));
  }

  saveProfile(profile) {
    mkdirSync(dirname(this.profilePath), { recursive: true });
    profile.updatedAt = new Date().toISOString();
    writeFileSync(this.profilePath, JSON.stringify(profile, null, 2) + '\n', 'utf8');
    return profile;
  }

  updateProfile(patch) {
    const current = this.loadProfile();
    const merged = {
      ...current,
      ...patch,
      coding: { ...current.coding, ...(patch.coding || {}) },
      ui: { ...current.ui, ...(patch.ui || {}) },
      communication: { ...current.communication, ...(patch.communication || {}) },
      customRules: patch.customRules || current.customRules,
    };
    return this.saveProfile(merged);
  }

  addRule(ruleText) {
    const current = this.loadProfile();
    if (!current.customRules.includes(ruleText)) {
      current.customRules.push(ruleText);
      this.saveProfile(current);
    }
    return current;
  }

  compileTasteContract() {
    const p = this.loadProfile();
    const rules = (p.customRules || []).map((r, i) => `  ${i + 1}. ${r}`).join('\n');
    return [
      '[USER TASTE CONTRACT]',
      `- Mode: ponytail:${p.coding.ponytailLevel} (smallest complete change, zero dead abstractions, stdlib first).`,
      `- Completeness: Full unabridged output required. Placeholder comments (TODO, TBD, "...rest of code") are forbidden.`,
      `- UI Archetype: ${p.ui.archetype} (substrate ${p.ui.substrate}, phosphor ${p.ui.foreground}, accent ${p.ui.accent}, 0px radius, 1px CSS grid, Variance=${p.ui.designVariance}, Motion=${p.ui.motionIntensity}, Density=${p.ui.visualDensity}).`,
      `- Communication: ${p.communication.style} (critique first, plain English, zero sycophancy).`,
      `- Learned Invariants:\n${rules}`,
    ].join('\n');
  }

  scoreOutput(outputText = '') {
    const text = String(outputText);
    const violations = [];
    let score = 1.0;

    if (/\/\/\s*TODO|\/\/\s*TBD|\.\.\.\s*\[truncated\]|rest of code here/i.test(text)) {
      violations.push('Contains truncation or placeholder TODO/TBD comment');
      score -= 0.45;
    }
    if (/\b(seamlessly|blazingly fast|delighted to|brilliant idea)\b/i.test(text)) {
      violations.push('Contains banned sycophantic/promotional phrasing (EGM violation)');
      score -= 0.2;
    }
    if (!text.trim()) {
      violations.push('Empty output');
      score = 0.0;
    }
    return {
      score: Math.max(0, Number(score.toFixed(2))),
      violations,
    };
  }
}
