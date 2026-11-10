import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_AUTOMATION_CONFIG_PATH = join(__dirname, '..', '..', 'config', 'automation.json');
export const DEFAULT_ONEDRIVE_INBOX = '/mnt/c/Users/aswat/OneDrive/Orch-Phone-Inbox.md';

export function defaultAutomationConfig(inboxPath = DEFAULT_ONEDRIVE_INBOX) {
  return {
    version: 1,
    enabled: true,
    pollIntervalMs: 6000,
    channels: {
      cloudNotesInbox: {
        enabled: true,
        inboxPath,
        secondaryInboxPath: join(__dirname, '..', '..', 'memory', 'Phone-Inbox.md'),
      },
      ntfy: {
        enabled: true,
        serverUrl: 'https://ntfy.sh',
        topicIn: 'agy-orch-aswath-cmd-9842',
        topicOut: 'agy-orch-aswath-out-9842',
      },
      telegram: {
        enabled: false,
        botToken: '',
        allowedChatIds: [],
      },
      agyRemoteControl: {
        enabled: false,
      },
    },
  };
}

export class PhoneAutomationBridge {
  constructor({
    engine,
    configPath = DEFAULT_AUTOMATION_CONFIG_PATH,
    inboxPath = null,
    dryRun = false,
  }) {
    this.engine = engine;
    this.configPath = configPath;
    this.overrideInboxPath = inboxPath;
    this.dryRun = dryRun;
    this.timer = null;
    this.isProcessing = false;
    this.lastTelegramOffset = 0;
    this.lastNtfySince = Math.floor(Date.now() / 1000);
    this.history = [];
    this.ensureInboxTemplates();
  }

  loadConfig() {
    if (!existsSync(this.configPath)) {
      const def = defaultAutomationConfig(this.overrideInboxPath || DEFAULT_ONEDRIVE_INBOX);
      this.saveConfig(def);
      return def;
    }
    const cfg = JSON.parse(readFileSync(this.configPath, 'utf8'));
    if (this.overrideInboxPath) {
      cfg.channels.cloudNotesInbox.inboxPath = this.overrideInboxPath;
    }
    return cfg;
  }

  saveConfig(cfg) {
    mkdirSync(dirname(this.configPath), { recursive: true });
    cfg.updatedAt = new Date().toISOString();
    writeFileSync(this.configPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    return cfg;
  }

  updateConfig(patch) {
    const cur = this.loadConfig();
    const next = {
      ...cur,
      ...patch,
      channels: {
        ...cur.channels,
        ...(patch.channels || {}),
      },
    };
    return this.saveConfig(next);
  }

  ensureInboxTemplates() {
    const cfg = this.loadConfig();
    const paths = [
      cfg.channels?.cloudNotesInbox?.inboxPath,
      cfg.channels?.cloudNotesInbox?.secondaryInboxPath,
    ].filter(Boolean);

    const template = [
      '# AGY Orchestrator — Phone & Cloud Notes Automation Inbox',
      '',
      'Add any task below from your phone (OneDrive / Google Keep / Obsidian / Mobile Editor) as `- [ ] your task`.',
      'The orchestrator daemon automatically detects `- [ ]` lines, marks them `- [~]` while running, and writes the result under `- [x]`.',
      '',
      '## Tasks',
      '',
    ].join('\n');

    for (const p of paths) {
      try {
        mkdirSync(dirname(p), { recursive: true });
        if (!existsSync(p)) {
          writeFileSync(p, template, 'utf8');
        }
      } catch {
        // ignore if OneDrive mount is temporarily unavailable
      }
    }
  }

  async processInboxFile(filePath = null) {
    const cfg = this.loadConfig();
    const targetPath = filePath || cfg.channels?.cloudNotesInbox?.inboxPath;
    if (!targetPath || !existsSync(targetPath)) {
      return { ok: false, executedCount: 0, reason: 'Inbox file does not exist' };
    }

    const content = readFileSync(targetPath, 'utf8');
    const lines = content.split(/\r?\n/);
    const pendingIndices = [];

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\s*-\s*\[\s\]\s+(.+)$/);
      if (m && m[1].trim()) {
        pendingIndices.push({ index: i, prompt: m[1].trim() });
      }
    }

    if (pendingIndices.length === 0) {
      return { ok: true, executedCount: 0 };
    }

    // Atomically mark all pending tasks as in-progress [- [~]] before running
    for (const item of pendingIndices) {
      lines[item.index] = `- [~] ${item.prompt}`;
    }
    writeFileSync(targetPath, lines.join('\n'), 'utf8');

    let executedCount = 0;
    for (const item of pendingIndices) {
      const startedAt = new Date().toISOString();
      this.engine.emitEvent('phone_task_received', {
        channel: 'cloudNotesInbox',
        filePath: targetPath,
        prompt: item.prompt,
      });

      const res = await this.engine.executeTask(item.prompt, {
        sessionId: 'phone-automation',
        dryRun: this.dryRun,
      });

      const currentLines = readFileSync(targetPath, 'utf8').split(/\r?\n/);
      const targetLineIdx = currentLines.findIndex(
        (l) => l.trim() === `- [~] ${item.prompt}` || l.trim() === `- [ ] ${item.prompt}`
      );

      const summarySnippet = String(res.finalOutput || '')
        .replace(/\r?\n/g, ' ')
        .slice(0, 360);

      const completedBlock = [
        `- [x] ${item.prompt}`,
        `  > **Orch Result (${startedAt} · ${res.mode} · ${res.steps.length} step(s))**: ${summarySnippet}`,
      ];

      if (targetLineIdx !== -1) {
        currentLines.splice(targetLineIdx, 1, ...completedBlock);
      } else {
        currentLines.push(...completedBlock);
      }
      writeFileSync(targetPath, currentLines.join('\n'), 'utf8');

      this.history.unshift({
        id: res.runId,
        timestamp: startedAt,
        channel: 'cloudNotesInbox',
        prompt: item.prompt,
        ok: res.ok,
        summary: summarySnippet,
      });
      executedCount++;
    }

    return { ok: true, executedCount };
  }

  async pollNtfy() {
    const cfg = this.loadConfig();
    const ntfy = cfg.channels?.ntfy;
    if (!ntfy?.enabled || !ntfy?.topicIn) return { polled: false };

    try {
      const url = `${ntfy.serverUrl.replace(/\/$/, '')}/${ntfy.topicIn}/json?poll=1&since=${this.lastNtfySince}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return { polled: false, status: res.status };
      const text = await res.text();
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

      for (const line of lines) {
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.time && msg.time >= this.lastNtfySince) {
          this.lastNtfySince = msg.time + 1;
        }
        if (msg.event === 'message' && msg.message) {
          const prompt = String(msg.message).trim();
          this.engine.emitEvent('phone_task_received', {
            channel: 'ntfy',
            prompt,
          });
          const runRes = await this.engine.executeTask(prompt, {
            sessionId: 'phone-ntfy',
            dryRun: this.dryRun,
          });
          await this.sendPhoneNotification(
            `Orch Completed: ${prompt.slice(0, 40)}`,
            runRes.finalOutput.slice(0, 1000)
          );
          this.history.unshift({
            id: runRes.runId,
            timestamp: new Date().toISOString(),
            channel: 'ntfy',
            prompt,
            ok: runRes.ok,
            summary: runRes.finalOutput.slice(0, 300),
          });
        }
      }
      return { polled: true };
    } catch {
      return { polled: false };
    }
  }

  async sendPhoneNotification(title, message) {
    const cfg = this.loadConfig();
    const ntfy = cfg.channels?.ntfy;
    if (!ntfy?.enabled || !ntfy?.topicOut) return { sent: false };
    try {
      const res = await fetch(`${ntfy.serverUrl.replace(/\/$/, '')}/${ntfy.topicOut}`, {
        method: 'POST',
        headers: { Title: title, Tags: 'robot,check' },
        body: String(message).slice(0, 2000),
        signal: AbortSignal.timeout(4000),
      });
      return { sent: res.ok };
    } catch (err) {
      return { sent: false, error: err.message };
    }
  }

  async toggleAgyRemoteControl(action = 'status') {
    try {
      const { stdout, stderr } = await execFileAsync(
        '/home/aswath/.local/bin/agy',
        ['remote-control', action],
        { timeout: 10000 }
      );
      return { ok: true, action, output: (stdout || stderr).trim() };
    } catch (err) {
      return { ok: false, action, error: err.message };
    }
  }

  start() {
    if (this.timer) return;
    const cfg = this.loadConfig();
    const interval = cfg.pollIntervalMs || 6000;
    this.timer = setInterval(async () => {
      if (this.isProcessing) return;
      this.isProcessing = true;
      try {
        const currentCfg = this.loadConfig();
        if (currentCfg.enabled) {
          if (currentCfg.channels?.cloudNotesInbox?.enabled) {
            await this.processInboxFile(currentCfg.channels.cloudNotesInbox.inboxPath);
            if (currentCfg.channels.cloudNotesInbox.secondaryInboxPath) {
              await this.processInboxFile(currentCfg.channels.cloudNotesInbox.secondaryInboxPath);
            }
          }
          if (currentCfg.channels?.ntfy?.enabled) {
            await this.pollNtfy();
          }
        }
      } catch {
        // ignore transient poll errors
      } finally {
        this.isProcessing = false;
      }
    }, interval);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  status() {
    return {
      running: Boolean(this.timer),
      config: this.loadConfig(),
      recentTasks: this.history.slice(0, 20),
    };
  }
}
