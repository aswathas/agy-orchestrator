import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SUPPORTED_AGY_THEMES = [
  'tokyo night',
  'solarized dark',
  'dark',
  'colorblind-friendly dark',
  'terminal',
  'light',
  'solarized light',
  'colorblind-friendly light',
];

export const WSL_AGY_SETTINGS_PATH = '/home/aswath/.gemini/antigravity-cli/settings.json';
export const WIN_AGY_SETTINGS_PATH = '/mnt/c/Users/aswat/.gemini/antigravity-cli/settings.json';
export const WIN_BRIDGE_DIR_WSL = '/mnt/c/Users/aswat/.agy-orch-bridge';
export const WIN_BRIDGE_DIR_WIN = 'C:\\Users\\aswat\\.agy-orch-bridge';
export const WIN_HOME_WIN = 'C:\\Users\\aswat';

export function toWinPath(posixPath) {
  if (!posixPath) return WIN_HOME_WIN;
  const s = String(posixPath).trim();
  if (/^[A-Za-z]:\\/.test(s)) return s;
  const m = s.match(/^\/mnt\/([a-zA-Z])(?:\/(.*))?$/);
  if (m) {
    const drive = m[1].toUpperCase();
    const rest = (m[2] || '').replace(/\//g, '\\');
    return `${drive}:\\${rest}`;
  }
  if (s.startsWith('/')) {
    return `\\\\wsl.localhost\\Ubuntu${s.replace(/\//g, '\\')}`;
  }
  return s;
}

export function toWslPath(winPath) {
  if (!winPath) return '/home/aswath';
  const s = String(winPath).trim();
  if (s.startsWith('/')) return s;
  const m = s.match(/^([A-Za-z]):\\(.*)$/);
  if (m) {
    const drive = m[1].toLowerCase();
    const rest = m[2].replace(/\\/g, '/');
    return `/mnt/${drive}/${rest}`.replace(/\/+$/, '');
  }
  const u = s.match(/^\\\\wsl\.localhost\\[^\\]+\\(.*)$/i);
  if (u) {
    return '/' + u[1].replace(/\\/g, '/');
  }
  return s;
}

export function ensureBridgeDir() {
  try {
    mkdirSync(WIN_BRIDGE_DIR_WSL, { recursive: true });
    return { wslPath: WIN_BRIDGE_DIR_WSL, winPath: WIN_BRIDGE_DIR_WIN };
  } catch {
    const fallback = '/tmp/agy-orch-bridge';
    mkdirSync(fallback, { recursive: true });
    return { wslPath: fallback, winPath: WIN_HOME_WIN };
  }
}

export function getAgyThemesStatus() {
  const readScheme = (p) => {
    try {
      if (!existsSync(p)) return 'unknown';
      const j = JSON.parse(readFileSync(p, 'utf8'));
      return j.colorScheme || 'default';
    } catch {
      return 'unknown';
    }
  };
  return {
    supported: SUPPORTED_AGY_THEMES,
    wsl: readScheme(WSL_AGY_SETTINGS_PATH),
    win: readScheme(WIN_AGY_SETTINGS_PATH),
  };
}

export function setAgyTheme(scheme, targets = ['wsl', 'win']) {
  const normalized = String(scheme).trim().toLowerCase();
  if (!SUPPORTED_AGY_THEMES.includes(normalized)) {
    throw new Error(
      `Unsupported agy theme "${scheme}". Valid themes: ${SUPPORTED_AGY_THEMES.join(', ')}`
    );
  }
  const updated = {};
  const applyToFile = (filePath, label) => {
    if (!existsSync(filePath)) return;
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    raw.colorScheme = normalized;
    writeFileSync(filePath, JSON.stringify(raw, null, 2) + '\n', 'utf8');
    updated[label] = normalized;
  };
  if (targets.includes('wsl')) applyToFile(WSL_AGY_SETTINGS_PATH, 'wsl');
  if (targets.includes('win')) applyToFile(WIN_AGY_SETTINGS_PATH, 'win');
  return updated;
}
