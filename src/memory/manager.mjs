import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_DB_PATH = join(__dirname, '..', '..', 'memory', 'orch-mem.db');
const ENGINE_PY = join(__dirname, 'hybrid_engine.py');
const CLAUDE_MEM_WORKER = process.env.CLAUDE_MEM_WORKER || 'http://127.0.0.1:37777';

export class MemoryManager {
  constructor({ dbPath = DEFAULT_DB_PATH } = {}) {
    this.dbPath = dbPath;
  }

  async _callEngine(cmd, payload = {}) {
    const { stdout } = await execFileAsync(
      'python3',
      [ENGINE_PY, this.dbPath, cmd, JSON.stringify(payload)],
      { maxBuffer: 10 * 1024 * 1024 }
    );
    return JSON.parse(stdout.trim());
  }

  async init() {
    return this._callEngine('init', {});
  }

  async storeMemory({
    tier = 'global',
    sessionId = 'global',
    category = 'general',
    title,
    content,
    tags = [],
    salience = 1.0,
  }) {
    return this._callEngine('store', {
      tier,
      sessionId,
      category,
      title,
      content,
      tags,
      salience,
    });
  }

  async searchHybrid(query, { limit = 8, includeClaudeMem = true, sessionId = null } = {}) {
    return this._callEngine('search', {
      query,
      limit,
      includeClaudeMem,
      sessionId,
    });
  }

  async saveHandoff(sessionId, handoffObj) {
    return this._callEngine('save_handoff', {
      sessionId,
      ...handoffObj,
    });
  }

  async getSessionContext(sessionId = 'default') {
    return this._callEngine('get_session', { sessionId });
  }

  async getStats() {
    return this._callEngine('stats', {});
  }

  async syncSessionToClaudeMem({ sessionId, lastAssistantMessage, platformSource = 'agy-orchestrator' }) {
    try {
      const res = await fetch(`${CLAUDE_MEM_WORKER}/api/sessions/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentSessionId: sessionId,
          last_assistant_message: String(lastAssistantMessage || '').slice(0, 4000),
          platformSource,
        }),
      });
      return { synced: res.ok, status: res.status };
    } catch (err) {
      return { synced: false, error: err.message };
    }
  }
}
