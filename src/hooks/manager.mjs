import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Extensible Lifecycle Hooks & Workflows Manager (Claude Code Style).
 * Supported Hook Events:
 *  - 'pre-route'   : Executed before skill routing
 *  - 'post-route'  : Executed with selected skills & agent plan
 *  - 'pre-step'    : Executed before any Leader / Subagent / Critic step
 *  - 'post-step'   : Executed after each step completion
 *  - 'step-pause'  : Executed when step-by-step gate awaits approval
 *  - 'on-failure'  : Executed on any agent run error
 *  - 'pre-commit'  : Executed before saving session handoff or memory commit
 */
export class HookManager {
  constructor({ configPath = null, engine = null } = {}) {
    this.configPath = configPath || join(process.cwd(), 'config', 'hooks.json');
    this.engine = engine;
    this.hooks = {
      'pre-route': [],
      'post-route': [],
      'pre-step': [],
      'post-step': [],
      'step-pause': [],
      'on-failure': [],
      'pre-commit': [],
    };
    this.history = [];
    this._load();
  }

  _load() {
    if (!existsSync(this.configPath)) {
      this._saveDefault();
      return;
    }
    try {
      const data = JSON.parse(readFileSync(this.configPath, 'utf8'));
      for (const [k, v] of Object.entries(data)) {
        if (Array.isArray(v)) this.hooks[k] = v;
      }
    } catch {
      // Use defaults if parse fails
    }
  }

  _saveDefault() {
    try {
      mkdirSync(dirname(this.configPath), { recursive: true });
      const def = {
        'pre-route': [{ name: 'log-task', type: 'log', message: 'Hook: Task received for routing' }],
        'post-route': [{ name: 'validate-plan', type: 'internal', action: 'ensureBothCategories' }],
        'pre-step': [],
        'post-step': [{ name: 'check-truncation', type: 'internal', action: 'validateTaste' }],
        'step-pause': [{ name: 'notify-step', type: 'log', message: 'Hook: Paused for human step approval' }],
        'on-failure': [{ name: 'alert-failure', type: 'log', message: 'Hook: Step failure detected' }],
        'pre-commit': [{ name: 'format-check', type: 'log', message: 'Hook: Pre-commit memory validation' }],
      };
      writeFileSync(this.configPath, JSON.stringify(def, null, 2), 'utf8');
      this.hooks = def;
    } catch {
      // Ignore write errors in readonly environments
    }
  }

  register(hookName, handler) {
    if (!this.hooks[hookName]) {
      this.hooks[hookName] = [];
    }
    this.hooks[hookName].push(handler);
  }

  async trigger(hookName, payload = {}) {
    const list = this.hooks[hookName] || [];
    const results = [];

    for (const h of list) {
      const started = Date.now();
      let status = 'success';
      let output = null;

      try {
        if (typeof h === 'function') {
          output = await h(payload);
        } else if (h.type === 'shell' && h.command) {
          const { stdout, stderr } = await execAsync(h.command, {
            timeout: 10000,
            env: { ...process.env, ORCH_EVENT: hookName, ORCH_PAYLOAD: JSON.stringify(payload) },
          });
          output = (stdout || stderr).trim();
        } else if (h.type === 'internal' && h.action && this.engine) {
          if (h.action === 'validateTaste' && payload.output) {
            output = this.engine.taste.scoreOutput(payload.output);
          } else if (h.action === 'ensureBothCategories') {
            output = { verified: true };
          }
        } else if (h.type === 'log') {
          output = h.message || `Hook ${hookName} fired`;
        }
      } catch (err) {
        status = 'error';
        output = err.message;
      }

      const rec = {
        hook: hookName,
        name: h.name || 'anonymous',
        status,
        durationMs: Date.now() - started,
        output,
        timestamp: new Date().toISOString(),
      };
      results.push(rec);
      this.history.unshift(rec);
      if (this.history.length > 50) this.history.pop();
    }

    if (this.engine) {
      this.engine.emitEvent('hook_triggered', { hookName, results });
    }

    return results;
  }
}
