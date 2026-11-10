import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * Studio = the human-in-the-loop front door of the harness.
 * States: clarifying -> awaiting_approval -> building -> preview (-> building on every chat change).
 */
export class StudioManager {
  constructor({ engine, dir = WORKSPACES_DIR } = {}) {
    this.engine = engine;
    this.dir = dir;
    this.sessions = new Map();
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
        if (s.state === 'building') s.state = 'preview';
        this.sessions.set(s.id, s);
      } catch {
        // skip corrupt session file
      }
    }
  }

  _save(s) {
    s.updatedAt = new Date().toISOString();
    writeFileSync(join(this.dir, s.id, 'session.json'), JSON.stringify(s, null, 2) + '\n', 'utf8');
    this.engine.emitEvent('studio_updated', { sessionId: s.id, state: s.state, progressPct: undefined });
    return s;
  }

  _say(s, role, text) {
    s.messages.push({ role, text, ts: new Date().toISOString() });
  }

  list() {
    return [...this.sessions.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((s) => ({ id: s.id, title: s.title, state: s.state, progressPct: s.progressPct, updatedAt: s.updatedAt }));
  }

  get(id) {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`Unknown studio session: ${id}`);
    return s;
  }

  /** Deterministic clarifying questions driven by task features + taste profile. */
  buildQuestions(prompt) {
    const { features } = this.engine.router.extractTaskFeatures(prompt);
    const taste = this.engine.taste.loadProfile();
    const q = [
      {
        id: 'deliverable',
        text: 'What are we building?',
        options: ['Web app / dashboard', 'CLI tool', 'API / backend service', 'Library / module', 'One-off script', 'Fix / refactor existing code'],
        default: features.frontend_ui ? 'Web app / dashboard' : features.debugging ? 'Fix / refactor existing code' : 'CLI tool',
      },
      {
        id: 'stack',
        text: 'Which stack?',
        options: ['Zero-build vanilla (HTML/CSS/JS or Node stdlib)', 'React + Vite', 'Node.js (ESM)', 'Python', 'You choose (ponytail: smallest that works)'],
        default: 'You choose (ponytail: smallest that works)',
      },
      {
        id: 'quality',
        text: 'Quality bar?',
        options: ['Throwaway prototype', 'Working MVP + tests', 'Production-ready (tests, docs, error handling)'],
        default: 'Working MVP + tests',
      },
    ];
    if (features.frontend_ui) {
      q.push({
        id: 'design',
        text: 'Visual direction?',
        options: [`Your taste profile (${taste.ui?.archetype || 'industrial-brutalist'})`, 'Minimal editorial', 'Playful / colorful', 'Match an existing design'],
        default: `Your taste profile (${taste.ui?.archetype || 'industrial-brutalist'})`,
      });
      q.push({ id: 'theme', text: 'Theme?', options: ['Dark', 'Light', 'Both with toggle'], default: 'Both with toggle' });
    }
    if (features.debugging) {
      q.push({ id: 'repro', text: 'Can you describe how to reproduce it?', options: [], default: '', free: true });
    }
    if (features.windows_os || features.wsl_linux) {
      q.push({ id: 'target', text: 'Runtime target?', options: ['WSL (Linux)', 'Windows native', 'Both (path bridge required)'], default: 'Both (path bridge required)' });
    }
    q.push({ id: 'constraints', text: 'Anything I must or must not do? (optional)', options: [], default: '', free: true });
    return q;
  }

  start(prompt, { dryRun = true, mode = 'egm' } = {}) {
    const id = `st-${Date.now().toString(36)}`;
    mkdirSync(join(this.dir, id, 'workspace'), { recursive: true });
    const s = {
      id,
      title: prompt.slice(0, 80),
      prompt,
      dryRun,
      mode,
      state: 'clarifying',
      createdAt: new Date().toISOString(),
      messages: [],
      questions: this.buildQuestions(prompt),
      answers: {},
      notes: [],
      spec: '',
      plan: [],
      revision: 0,
      pendingChanges: [],
      progressPct: 0,
      stageLabel: '',
      runs: [],
      lastOutput: '',
    };
    this._say(s, 'user', prompt);
    this._say(s, 'orch', `Before I build anything I need to confirm ${s.questions.length} things. Answer below (defaults are pre-selected), or just chat to add context.`);
    this.sessions.set(id, s);
    this.engine.emitEvent('studio_questions', { sessionId: id });
    return this._save(s);
  }

  answer(id, answers = {}) {
    const s = this.get(id);
    for (const q of s.questions) s.answers[q.id] = answers[q.id] ?? s.answers[q.id] ?? q.default;
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
      '## Confirmed decisions',
      ...s.questions.map((q) => `- **${q.id}:** ${a[q.id] || '—'}`),
      ...(s.notes.length ? ['', '## Extra context from chat', ...s.notes.map((n) => `- ${n}`)] : []),
      '',
      `## Routing`,
      `- Complexity: ${routing.complexityScore}`,
      `- Skills mounted: ${routing.selectedSkills.map((k) => k.name).join(', ') || 'none'}`,
      `- Workers: ${workers.join(', ') || 'leader only'}`,
    ].join('\n');
    s.plan = [
      { id: 'p1', title: 'Skill routing + memory recall + taste contract', owner: 'router', status: 'pending' },
      { id: 'p2', title: 'Leader writes architecture & file layout', owner: 'leader', status: 'pending' },
      { id: 'p3', title: `Workers implement (${workers.join(', ') || 'none'})`, owner: 'workers', status: 'pending' },
      ...(s.mode === 'egm' ? [{ id: 'p4', title: 'Fresh-context Goldfish critic attacks the draft', owner: 'goldfish', status: 'pending' }] : []),
      { id: 'p5', title: 'Preview rendered, DPO learning + memory commit', owner: 'learn', status: 'pending' },
    ];
    s.state = 'awaiting_approval';
    this._say(s, 'orch', `Plan ready (rev ${s.revision}). Review the spec and steps on the right, chat to change anything, then press Approve & Build.`);
    this.engine.emitEvent('studio_plan', { sessionId: s.id });
  }

  chat(id, text) {
    const s = this.get(id);
    this._say(s, 'user', text);
    if (s.state === 'clarifying') {
      s.notes.push(text);
      this._say(s, 'orch', 'Noted. I added it to the context. Submit the answers when ready.');
    } else if (s.state === 'awaiting_approval') {
      s.notes.push(text);
      this._makePlan(s);
    } else if (s.state === 'building') {
      s.pendingChanges.push(text);
      this._say(s, 'orch', 'Build in progress. Your change is queued and will be applied right after this pass.');
    } else {
      this._startBuild(s, text);
    }
    return this._save(s);
  }

  approve(id) {
    const s = this.get(id);
    if (s.state !== 'awaiting_approval') throw new Error(`Cannot approve in state ${s.state}`);
    this._startBuild(s, null);
    return this._save(s);
  }

  _startBuild(s, change) {
    const runId = `run-${s.id}-${s.runs.length + 1}`;
    s.runs.push(runId);
    s.state = 'building';
    s.progressPct = 2;
    s.plan.forEach((p) => (p.status = 'pending'));
    this._say(s, 'orch', change ? `Applying change: "${change}"` : 'Approved. Building now. Watch progress and the preview.');
    const prompt = [
      `Build the following in the working directory (write real files; include index.html if it has a UI).`,
      s.spec,
      ...s.runs.length > 1 ? [`\n## Change request\n${change || s.pendingChanges.join('\n')}`] : [],
    ].join('\n');
    this.engine
      .executeTask(prompt, {
        runId,
        mode: s.mode,
        sessionId: s.id,
        cwd: join(this.dir, s.id, 'workspace'),
        dryRun: s.dryRun,
      })
      .then((res) => {
        s.lastOutput = res.finalOutput || '';
        s.plan.forEach((p) => (p.status = 'done'));
        s.progressPct = 100;
        s.state = 'preview';
        this._say(s, 'orch', `Pass complete (${res.steps.length} agent steps). Preview updated. Chat a change to iterate.`);
        const next = s.pendingChanges.splice(0).join('\n');
        this._save(s);
        if (next) {
          this._startBuild(s, next);
          this._save(s);
        }
      })
      .catch((err) => {
        s.state = 'preview';
        this._say(s, 'orch', `Build failed: ${err.message}`);
        this._save(s);
      });
  }

  _onEngineEvent(ev) {
    if (!ev.runId?.startsWith('run-st-')) return;
    const s = [...this.sessions.values()].find((x) => x.runs.includes(ev.runId));
    if (!s || s.state !== 'building') return;
    if (ev.progressPct !== undefined) s.progressPct = ev.progressPct;
    if (ev.stageLabel) s.stageLabel = ev.stageLabel;
    const mark = (idx) => s.plan.forEach((p, i) => (p.status = i < idx ? 'done' : i === idx ? 'active' : 'pending'));
    const byOwner = (o) => s.plan.findIndex((p) => p.owner === o);
    if (ev.type === 'task_started' || ev.type === 'routing_completed') mark(byOwner('router'));
    else if (ev.step === 'leader' && ev.type === 'step_started') mark(byOwner('leader'));
    else if (ev.step === 'subagent' && ev.type === 'step_started') mark(byOwner('workers'));
    else if (ev.step === 'goldfish-critic' && ev.type === 'step_started') mark(byOwner('goldfish'));
    writeFileSync(join(this.dir, s.id, 'session.json'), JSON.stringify(s, null, 2) + '\n', 'utf8');
  }

  /** Resolve a preview file safely, falling back to a generated spec/plan/output page. */
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
<h1>LIVE BUILD PREVIEW // ${esc(s.title)}</h1><p class="note">state: ${esc(s.state)} · ${s.progressPct}% · no index.html in workspace yet, showing generated status view</p>
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
