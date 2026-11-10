import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrainstormEngine } from '../brainstorm/engine.mjs';
import { WorkspaceDiffEngine } from './diff.mjs';
import { HookManager } from '../hooks/manager.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const WORKSPACES_DIR = join(__dirname, '..', '..', 'workspaces');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * StudioManager v2 (Claude Code Style):
 *  - Dynamic LLM Brainstorming & Interactive Questioning
 *  - Workspace File Tree & Visual Diff Tracking
 *  - Two-Way Phone Synchronization
 *  - Step-by-Step Interactive Execution & Gated Approvals
 *  - Lifecycle Hooks Triggering
 */
export class StudioManager {
  constructor({ engine, dir = WORKSPACES_DIR, phoneBridge = null } = {}) {
    this.engine = engine;
    this.dir = dir;
    this.phoneBridge = phoneBridge;
    this.brainstorm = new BrainstormEngine({ engine });
    this.hooks = new HookManager({ engine });
    this.sessions = new Map();
    this.stepWaiters = new Map();
    mkdirSync(dir, { recursive: true });
    this._load();
    engine.events.on('event', (ev) => this._onEngineEvent(ev));
  }

  _load() {
    for (const name of readdirSync(this.dir)) {
      const f = join(this.dir, name, 'session.json');
      if (!existsSync(f)) continue;
      try {
        const s = JSON.parse(readFileSync(f, 'utf8'));
        if (s.state === 'building' || s.state === 'step_paused') s.state = 'preview';
        this.sessions.set(s.id, s);
      } catch {
        // Skip corrupt session files
      }
    }
  }

  _save(s) {
    s.updatedAt = new Date().toISOString();
    writeFileSync(join(this.dir, s.id, 'session.json'), JSON.stringify(s, null, 2) + '\n', 'utf8');
    this.engine.emitEvent('studio_updated', {
      sessionId: s.id,
      state: s.state,
      progressPct: s.progressPct,
      stepMode: s.stepMode,
    });
    return s;
  }

  _say(s, role, text) {
    s.messages.push({ role, text, ts: new Date().toISOString() });
  }

  list() {
    return [...this.sessions.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((s) => ({
        id: s.id,
        title: s.title,
        state: s.state,
        progressPct: s.progressPct,
        stepMode: s.stepMode || 'continuous',
        updatedAt: s.updatedAt,
      }));
  }

  get(id) {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`Unknown studio session: ${id}`);
    return s;
  }

  getDiffEngine(id) {
    const s = this.get(id);
    return new WorkspaceDiffEngine(join(this.dir, s.id, 'workspace'));
  }

  async start(prompt, { dryRun = true, mode = 'egm', stepMode = 'continuous' } = {}) {
    const id = `st-${Date.now().toString(36)}`;
    const wsPath = join(this.dir, id, 'workspace');
    mkdirSync(wsPath, { recursive: true });

    await this.hooks.trigger('pre-route', { prompt, sessionId: id });

    // Dynamic LLM brainstorming interview
    const brainstormResult = await this.brainstorm.generateQuestions(prompt, { dryRun });

    const s = {
      id,
      title: prompt.slice(0, 80),
      prompt,
      dryRun,
      mode,
      stepMode, // 'continuous' or 'step-by-step'
      state: 'clarifying',
      createdAt: new Date().toISOString(),
      messages: [],
      analysis: brainstormResult.analysis || '',
      questions: brainstormResult.questions || [],
      answers: {},
      notes: [],
      spec: '',
      plan: [],
      currentStepIndex: 0,
      snapshots: {},
      diffs: [],
      revision: 0,
      pendingChanges: [],
      progressPct: 0,
      stageLabel: '',
      runs: [],
      lastOutput: '',
    };

    this._say(s, 'user', prompt);
    this._say(
      s,
      'orch',
      `[LLM Brainstorm] ${s.analysis}\n\nI need clarification on ${s.questions.length} architectural choices before proceeding. Answer the cards below or chat directly.`
    );

    // Sync to Phone if connected
    if (this.phoneBridge) {
      this._syncQuestionToPhone(s);
    }

    this.sessions.set(id, s);
    this.engine.emitEvent('studio_questions', { sessionId: id });
    return this._save(s);
  }

  _syncQuestionToPhone(s) {
    try {
      const cfg = this.phoneBridge.loadConfig();
      const inbox = cfg?.channels?.cloudNotesInbox?.inboxPath;
      if (inbox && existsSync(inbox)) {
        const lines = readFileSync(inbox, 'utf8').trimEnd();
        const questionText = s.questions.map((q) => `  - [?] ${q.id}: ${q.text} (default: ${q.default})`).join('\n');
        const append = `\n\n### Studio Session [${s.id}]: ${s.title}\n${questionText}\n- [ ] Reply: #orch ${s.id} <answers>`;
        writeFileSync(inbox, lines + append + '\n', 'utf8');
      }
    } catch {
      // Ignore phone sync errors
    }
  }

  answer(id, answers = {}) {
    const s = this.get(id);
    for (const q of s.questions) {
      s.answers[q.id] = answers[q.id] ?? s.answers[q.id] ?? q.default;
    }
    this._say(s, 'user', 'Answers: ' + s.questions.map((q) => `${q.id}=${s.answers[q.id] || '—'}`).join('; '));
    this._makePlan(s);
    return this._save(s);
  }

  _makePlan(s) {
    s.revision += 1;
    const routing = this.engine.router.routeTask(s.prompt, { topology: this.engine.topology.load(), maxSkills: 4 });
    const workers = routing.agentPlan.selectedWorkers.map((w) => w.id);
    const a = s.answers;

    s.spec = [
      `# Build Spec (rev ${s.revision})`,
      `**Goal:** ${s.prompt}`,
      '',
      `## Brainstorm Analysis`,
      `${s.analysis}`,
      '',
      '## Confirmed Architectural Decisions',
      ...s.questions.map((q) => `- **${q.id}:** ${a[q.id] || '—'}`),
      ...(s.notes.length ? ['', '## Extra Context / Iterations', ...s.notes.map((n) => `- ${n}`)] : []),
      '',
      `## Routing & Execution Allocation`,
      `- Complexity Score: ${routing.complexityScore}`,
      `- Mounted Skills: ${routing.selectedSkills.map((k) => k.name).join(', ') || 'none'}`,
      `- Assigned Subagents: ${workers.join(', ') || 'Main Leader Only'}`,
    ].join('\n');

    s.plan = [
      { id: 'p1', title: '1. Skill Routing, 3-Tier Memory Recall & Taste Contract', owner: 'router', status: 'pending' },
      { id: 'p2', title: '2. Leader Architecture & Implementation Specification', owner: 'leader', status: 'pending' },
      { id: 'p3', title: `3. Subagent Worker Implementation (${workers.join(', ') || 'None'})`, owner: 'workers', status: 'pending' },
      ...(s.mode === 'egm' ? [{ id: 'p4', title: '4. Adversarial EGM Goldfish Review (Opposite Model Family)', owner: 'goldfish', status: 'pending' }] : []),
      { id: 'p5', title: '5. Workspace Commit, Diff Generation & DPO Learning Update', owner: 'learn', status: 'pending' },
    ];

    s.state = 'awaiting_approval';
    this._say(
      s,
      'orch',
      `Plan generated (rev ${s.revision}). Mode: ${s.stepMode.toUpperCase()}. Review the spec and execution gates, request changes, or click Approve.`
    );
    this.engine.emitEvent('studio_plan', { sessionId: s.id });
    this.hooks.trigger('post-route', { sessionId: s.id, plan: s.plan, routing });
  }

  chat(id, text) {
    const s = this.get(id);
    this._say(s, 'user', text);

    if (s.state === 'clarifying') {
      s.notes.push(text);
      this._say(s, 'orch', 'Noted. I incorporated your input into the brainstorm context. Submit answers when ready.');
    } else if (s.state === 'awaiting_approval') {
      s.notes.push(text);
      this._makePlan(s);
    } else if (s.state === 'step_paused') {
      s.notes.push(text);
      this._say(s, 'orch', `Change noted during step approval: "${text}". Resuming step with your amendment.`);
      this.stepApprove(id);
    } else if (s.state === 'building') {
      s.pendingChanges.push(text);
      this._say(s, 'orch', 'Build currently running. Your modification is queued for the next pass.');
    } else {
      this._startBuild(s, text);
    }
    return this._save(s);
  }

  setStepMode(id, stepMode) {
    const s = this.get(id);
    s.stepMode = stepMode === 'step-by-step' ? 'step-by-step' : 'continuous';
    return this._save(s);
  }

  approve(id) {
    const s = this.get(id);
    if (s.state !== 'awaiting_approval') throw new Error(`Cannot approve session in state: ${s.state}`);
    this._startBuild(s, null);
    return this._save(s);
  }

  /**
   * Resumes execution when paused in step-by-step mode.
   */
  stepApprove(id) {
    const s = this.get(id);
    if (s.state !== 'step_paused') return s;
    const waiter = this.stepWaiters.get(id);
    if (waiter) {
      this.stepWaiters.delete(id);
      s.state = 'building';
      this._save(s);
      waiter();
    }
    return s;
  }

  _waitForStepApproval(s, stepName) {
    return new Promise((resolve) => {
      s.state = 'step_paused';
      this._save(s);
      this._say(s, 'orch', `[Gate Paused] Step "${stepName}" completed. Review the workspace diff and confirm to proceed.`);
      this.hooks.trigger('step-pause', { sessionId: s.id, stepName });
      this.stepWaiters.set(s.id, resolve);
    });
  }

  async _startBuild(s, change) {
    const runId = `run-${s.id}-${s.runs.length + 1}`;
    s.runs.push(runId);
    s.state = 'building';
    s.progressPct = 5;
    s.plan.forEach((p) => (p.status = 'pending'));

    const diffEngine = this.getDiffEngine(s.id);
    const beforeSnapshot = diffEngine.takeSnapshot();

    this._say(s, 'orch', change ? `Applying amendment: "${change}"` : `Executing plan in ${s.stepMode.toUpperCase()} mode...`);

    const prompt = [
      `Build the requested project in the working directory (write real files; include index.html for UI deliverables).`,
      s.spec,
      ...(change || s.pendingChanges.length ? [`\n## Change Request\n${change || s.pendingChanges.join('\n')}`] : []),
    ].join('\n');

    try {
      await this.hooks.trigger('pre-step', { sessionId: s.id, runId });

      const res = await this.engine.executeTask(prompt, {
        runId,
        mode: s.mode,
        sessionId: s.id,
        cwd: join(this.dir, s.id, 'workspace'),
        dryRun: s.dryRun,
      });

      // Compute workspace file diff
      const afterSnapshot = diffEngine.takeSnapshot();
      s.diffs = diffEngine.computeDiff(beforeSnapshot, afterSnapshot);
      s.snapshots[s.runs.length] = afterSnapshot;

      s.lastOutput = res.finalOutput || '';
      s.plan.forEach((p) => (p.status = 'done'));
      s.progressPct = 100;
      s.state = 'preview';

      await this.hooks.trigger('post-step', { sessionId: s.id, runId, output: s.lastOutput });
      await this.hooks.trigger('pre-commit', { sessionId: s.id, diffsCount: s.diffs.length });

      this._say(
        s,
        'orch',
        `Pass complete (${res.steps.length} steps). ${s.diffs.length} file(s) modified. Preview and diffs updated.`
      );

      const next = s.pendingChanges.splice(0).join('\n');
      this._save(s);
      if (next) {
        this._startBuild(s, next);
        this._save(s);
      }
    } catch (err) {
      s.state = 'preview';
      this._say(s, 'orch', `Build error: ${err.message}`);
      await this.hooks.trigger('on-failure', { sessionId: s.id, error: err.message });
      this._save(s);
    }
  }

  _onEngineEvent(ev) {
    if (!ev.runId?.startsWith('run-st-')) return;
    const s = [...this.sessions.values()].find((x) => x.runs.includes(ev.runId));
    if (!s || (s.state !== 'building' && s.state !== 'step_paused')) return;

    if (ev.progressPct !== undefined) s.progressPct = ev.progressPct;
    if (ev.stageLabel) s.stageLabel = ev.stageLabel;

    const mark = (idx) => s.plan.forEach((p, i) => (p.status = i < idx ? 'done' : i === idx ? 'active' : 'pending'));
    const byOwner = (o) => s.plan.findIndex((p) => p.owner === o);

    if (ev.type === 'task_started' || ev.type === 'routing_completed') mark(byOwner('router'));
    else if (ev.step === 'leader' && ev.type === 'step_started') mark(byOwner('leader'));
    else if (ev.step === 'subagent' && ev.type === 'step_started') mark(byOwner('workers'));
    else if (ev.step === 'goldfish-critic' && ev.type === 'step_started') mark(byOwner('goldfish'));

    // In step-by-step mode, pause if an agent step completed and wait for approval
    if (s.stepMode === 'step-by-step' && ev.type === 'step_completed') {
      this._waitForStepApproval(s, ev.step || 'agent-phase');
    }

    writeFileSync(join(this.dir, s.id, 'session.json'), JSON.stringify(s, null, 2) + '\n', 'utf8');
  }

  servePreview(id, relPath) {
    const s = this.get(id);
    const root = resolve(this.dir, id, 'workspace');
    const target = resolve(root, relPath && relPath !== '/' ? '.' + (relPath.startsWith('/') ? relPath : '/' + relPath) : 'index.html');
    if (target !== root && !target.startsWith(root + sep)) return { status: 403, type: 'text/plain', body: 'Forbidden' };
    if (existsSync(target) && !readdirSafe(target)) {
      const ext = target.slice(target.lastIndexOf('.'));
      return { status: 200, type: MIME[ext] || 'application/octet-stream', body: readFileSync(target) };
    }
    if (relPath && relPath !== '/' && relPath !== '/index.html') return { status: 404, type: 'text/plain', body: 'Not found' };
    return { status: 200, type: MIME['.html'], body: this._fallbackHtml(s) };
  }

  _fallbackHtml(s) {
    const steps = s.plan.map((p) => `<li class="${p.status}">${esc(p.title)} <b>${esc(p.status)}</b></li>`).join('');
    return `<!doctype html><meta charset="utf-8"><title>Preview ${esc(s.id)}</title>
<style>body{font:13px ui-monospace,monospace;margin:0;padding:18px;background:#101218;color:#eaecef}h1{font-size:14px;color:#ff4f00;margin:0 0 8px}
pre{white-space:pre-wrap;background:#0c0e13;border:1px solid #222634;padding:10px}li{margin:3px 0}li.done b{color:#10b981}li.active b{color:#f59e0b}.note{color:#949ba6}</style>
<h1>LIVE BUILD PREVIEW // ${esc(s.title)}</h1><p class="note">state: ${esc(s.state)} · ${s.progressPct}% · ${esc(s.stepMode)} mode · no index.html yet</p>
<ul>${steps}</ul><pre>${esc(s.spec)}</pre>${s.lastOutput ? `<h1>LATEST AGENT OUTPUT</h1><pre>${esc(s.lastOutput.slice(0, 6000))}</pre>` : ''}`;
  }
}

function readdirSafe(p) {
  try {
    return readdirSync(p) && true;
  } catch {
    return false;
  }
}
