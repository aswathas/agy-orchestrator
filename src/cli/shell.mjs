import readline from 'node:readline';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { StudioManager } from '../studio/session.mjs';
import { getAgyThemesStatus, setAgyTheme } from '../adapters/path-bridge.mjs';
import { OrchEvaluationSuite } from '../eval/benchmark.mjs';

const tty = process.stdout.isTTY;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const orange = (s) => (tty ? `\x1b[38;5;202m${s}\x1b[0m` : s);
const dim = (s) => c('2', s);
const bold = (s) => c('1', s);
const green = (s) => c('32', s);
const cyan = (s) => c('36', s);
const red = (s) => c('31', s);

const HELP = `
${bold('Talk to build')}
  just type a goal            starts a dialogue: questions -> plan -> approve -> build -> preview
  (after a build) type text   applies it as a change request to the same project
${bold('Slash commands')}
  /status                     leader, critic, workers, memory, skills
  /leader <surface:model>     switch Main Leader (critic flips to opposite family)
  /swap <workerId>            swap Leader with a subagent
  /mode egm|full|single|adaptive   execution mode for builds
  /dry on|off                 simulated agents vs live CLI agents
  /plan   /spec               show current plan / spec
  /preview   /files           preview URL + workspace files
  /sessions   /resume <id>   /new
  /memory <query>             hybrid RRF memory search
  /remember <fact>            pin a fact to global memory
  /teach <rule>               add a permanent taste rule
  /skills <query>             run the skill router
  /theme <name>               set AGY CLI theme (WSL + Windows)
  /eval                       run quantitative benchmarks
  /ui                         print dashboard command
  !<shell cmd>                run a shell command inside the project workspace
  /help   /exit
`;

export class OrchCodeShell {
  constructor({ engine, dryRun = true, mode = 'egm', auto = false, port = 4888 } = {}) {
    this.engine = engine;
    this.studio = new StudioManager({ engine });
    this.dryRun = dryRun;
    this.mode = mode;
    this.auto = auto;
    this.port = port;
    this.session = null;
    this.rl = null;
    this._barActive = false;
    engine.events.on('event', (ev) => this._onEvent(ev));
  }

  _onEvent(ev) {
    if (!this.session || !ev.runId || !this.session.runs.includes(ev.runId) || ev.progressPct === undefined) return;
    const w = 28;
    const filled = Math.round((ev.progressPct / 100) * w);
    const bar = '█'.repeat(filled) + '░'.repeat(w - filled);
    const line = `${orange(bar)} ${String(Math.round(ev.progressPct)).padStart(3)}% ${dim(ev.stageLabel || '')}`;
    if (tty) process.stdout.write(`\r\x1b[2K${line}`);
    else console.log(line);
    this._barActive = true;
  }

  _endBar() {
    if (this._barActive && tty) process.stdout.write('\n');
    this._barActive = false;
  }

  ask(q) {
    process.stdout.write(q);
    return new Promise((resolve) => {
      if (this.queue.length) return resolve(this.queue.shift());
      if (this.closed) return resolve(null);
      this.waiter = resolve;
    });
  }

  say(role, text) {
    const tag = role === 'orch' ? orange('orch') : cyan('you ');
    console.log(`${tag} ${text}`);
  }

  banner() {
    const t = this.engine.topology.load();
    console.log(orange(bold('ORCH CODE')) + dim('  dual-category agentic coding shell'));
    console.log(dim(`leader ${t.leader.surface}:${t.leader.model}  |  critic ${t.goldfishCritic.surface}:${t.goldfishCritic.model}`));
    console.log(dim(`mode ${this.mode}  |  agents ${this.dryRun ? 'SIMULATED (/dry off for live)' : 'LIVE'}  |  /help for commands`));
  }

  async run() {
    this.rl = readline.createInterface({ input: process.stdin, terminal: Boolean(tty) });
    this.queue = [];
    this.closed = false;
    this.waiter = null;
    this.rl.on('line', (l) => {
      if (this.waiter) { const w = this.waiter; this.waiter = null; w(l); } else this.queue.push(l);
    });
    this.rl.on('close', () => {
      this.closed = true;
      if (this.waiter) { const w = this.waiter; this.waiter = null; w(null); }
    });
    this.banner();
    while (!this.closed || this.queue.length) {
      const label = this.session ? `${orange('orch')}${dim(`[${this.session.state}]`)} ❯ ` : `${orange('orch')} ❯ `;
      const line = await this.ask(label);
      if (line === null) break;
      const text = String(line || '').trim();
      if (!text) continue;
      try {
        if (text === '/exit' || text === '/quit') break;
        if (text.startsWith('/')) await this.slash(text);
        else if (text.startsWith('!')) await this.shell(text.slice(1));
        else await this.talk(text);
      } catch (err) {
        console.log(red(`error: ${err.message}`));
      }
    }
    this.rl.close();
  }

  /** Non-interactive: defaults for every question, auto-approve, print final output. */
  async runOnce(prompt) {
    this.engine.events.on('event', () => {});
    const s = this.studio.start(prompt, { dryRun: this.dryRun, mode: this.mode });
    this.session = s;
    this.studio.answer(s.id, {});
    this.studio.approve(s.id);
    await this.waitBuild(s);
    this._endBar();
    console.log(s.lastOutput);
    console.log(dim(`workspace: ${join(this.studio.dir, s.id, 'workspace')}`));
    return s;
  }

  waitBuild(s) {
    return new Promise((resolve) => {
      const check = () => {
        if (s.state !== 'building') {
          this.engine.events.off('event', check);
          resolve();
        }
      };
      this.engine.events.on('event', check);
      check();
    });
  }

  async talk(text) {
    const s = this.session;
    if (!s) return this.dialogue(text);
    if (s.state === 'clarifying') return this.questions(s);
    if (s.state === 'awaiting_approval') {
      this.studio.chat(s.id, text);
      this.printTail(s, 2);
      return this.approval(s);
    }
    this.studio.chat(s.id, text);
    this.printTail(s, 1);
    await this.waitBuild(s);
    this._endBar();
    this.printTail(s, 1);
    this.showOutput(s);
  }

  async dialogue(prompt) {
    const s = this.studio.start(prompt, { dryRun: this.dryRun, mode: this.mode });
    this.session = s;
    this.printTail(s, 1);
    await this.questions(s);
  }

  async questions(s) {
    const answers = {};
    for (const q of s.questions) {
      console.log('\n' + bold(q.text));
      if (q.free) {
        const a = await this.ask(dim('  (enter to skip) ') + '› ');
        answers[q.id] = (a || '').trim() || q.default;
        continue;
      }
      q.options.forEach((o, i) => console.log(`  ${orange(i + 1)}. ${o}${o === q.default ? dim('  (default)') : ''}`));
      const a = (await this.ask('› ')).trim();
      const n = Number(a);
      answers[q.id] = n >= 1 && n <= q.options.length ? q.options[n - 1] : a || q.default;
    }
    this.studio.answer(s.id, answers);
    console.log('\n' + dim('— spec —'));
    console.log(s.spec);
    console.log(dim('— plan —'));
    s.plan.forEach((p, i) => console.log(`  ${i + 1}. ${p.title} ${dim(`[${p.owner}]`)}`));
    await this.approval(s);
  }

  async approval(s) {
    const a = (await this.ask(`\n${bold('Approve & build?')} ${dim('[y = build / type a change / n = hold]')} › `)).trim();
    if (/^y(es)?$/i.test(a)) {
      this.studio.approve(s.id);
      await this.waitBuild(s);
      this._endBar();
      this.showOutput(s);
    } else if (a && !/^n(o)?$/i.test(a)) {
      this.studio.chat(s.id, a);
      this.printTail(s, 1);
      await this.approval(s);
    } else {
      console.log(dim('Held. Type a change, or /plan, then answer y when ready. (any text re-opens approval)'));
    }
  }

  showOutput(s) {
    console.log('\n' + bold('── result ──'));
    console.log(s.lastOutput.slice(0, 4000));
    const ws = join(this.studio.dir, s.id, 'workspace');
    const files = existsSync(ws) ? readdirSync(ws) : [];
    console.log(dim(`workspace: ${ws}  (${files.length} file${files.length === 1 ? '' : 's'})`));
    console.log(dim(`preview:   http://127.0.0.1:${this.port}/preview/${s.id}/   (run /ui to serve it)`));
    console.log(dim('Type a change to iterate, or /new to start another project.'));
  }

  printTail(s, n) {
    s.messages.filter((m) => m.role === 'orch').slice(-n).forEach((m) => this.say('orch', m.text));
  }

  shell(cmd) {
    const cwd = this.session ? join(this.studio.dir, this.session.id, 'workspace') : process.cwd();
    return new Promise((resolve) => {
      execFile('bash', ['-lc', cmd], { cwd, timeout: 60000 }, (err, so, se) => {
        process.stdout.write(so || '');
        process.stderr.write(se || (err && !so ? String(err.message) + '\n' : ''));
        resolve();
      });
    });
  }

  async slash(line) {
    const [cmd, ...rest] = line.split(/\s+/);
    const arg = rest.join(' ').trim();
    const eng = this.engine;
    switch (cmd) {
      case '/help': console.log(HELP); break;
      case '/status': {
        const t = eng.topology.load();
        const m = await eng.memory.getStats();
        console.log(`${bold('leader')}  ${t.leader.surface}:${t.leader.model} [${t.leader.category}]`);
        console.log(`${bold('critic')}  ${t.goldfishCritic.surface}:${t.goldfishCritic.model} [${t.goldfishCritic.category}]`);
        for (const [id, w] of Object.entries(t.subagents)) console.log(`  ${id.padEnd(18)} ${w.surface}:${w.model} [${w.category}]`);
        console.log(`${bold('memory')}  ${m.claudeMemObservations} claude-mem + ${m.localMemories} local   ${bold('skills')} ${eng.router.catalog.length}`);
        console.log(`${bold('themes')}  ${JSON.stringify(getAgyThemesStatus())}`);
        break;
      }
      case '/leader': { const u = eng.topology.setLeader(arg); console.log(green(`leader -> ${u.leader.surface}:${u.leader.model}; critic -> ${u.goldfishCritic.surface}:${u.goldfishCritic.model}`)); break; }
      case '/swap': { const u = eng.topology.swapLeaderWithSubagent(arg); console.log(green(`leader is now ${u.leader.surface}:${u.leader.model}`)); break; }
      case '/mode': if (!['egm', 'full', 'single', 'adaptive'].includes(arg)) throw new Error('egm|full|single|adaptive'); this.mode = arg; if (this.session) this.session.mode = arg; console.log(green(`mode = ${arg}`)); break;
      case '/dry': this.dryRun = arg !== 'off'; if (this.session) this.session.dryRun = this.dryRun; console.log(green(`agents ${this.dryRun ? 'SIMULATED' : 'LIVE'}`)); break;
      case '/plan': if (!this.session) return console.log(dim('no session')); this.session.plan.forEach((p, i) => console.log(`${i + 1}. [${p.status}] ${p.title}`)); break;
      case '/spec': console.log(this.session?.spec || dim('no spec yet')); break;
      case '/preview':
      case '/files': {
        if (!this.session) return console.log(dim('no session'));
        const ws = join(this.studio.dir, this.session.id, 'workspace');
        console.log(`preview http://127.0.0.1:${this.port}/preview/${this.session.id}/`);
        for (const f of existsSync(ws) ? readdirSync(ws) : []) console.log(`  ${f}${statSync(join(ws, f)).isDirectory() ? '/' : ''}`);
        break;
      }
      case '/sessions': this.studio.list().forEach((s) => console.log(`${s.id}  ${s.state.padEnd(18)} ${s.title}`)); break;
      case '/resume': this.session = this.studio.get(arg); console.log(green(`resumed ${arg} (${this.session.state})`)); break;
      case '/new': this.session = null; console.log(dim('ready for a new goal')); break;
      case '/memory': { const r = await eng.memory.searchHybrid(arg, { limit: 6, includeClaudeMem: true }); (r.results || []).forEach((x) => console.log(`${orange(x.source.padEnd(10))} ${bold(x.title)}\n   ${dim(String(x.content).slice(0, 160))}`)); break; }
      case '/remember': await eng.memory.storeMemory({ tier: 'global', category: 'decision', title: arg.slice(0, 80), content: arg, salience: 1.3 }); console.log(green('pinned')); break;
      case '/teach': eng.taste.addRule(arg); console.log(green('taste rule added')); break;
      case '/skills': { const r = eng.router.routeTask(arg, { topology: eng.topology.load(), maxSkills: 5 }); r.selectedSkills.forEach((s, i) => console.log(`${i + 1}. ${bold(s.name)} ${dim('rrf=' + s.rrfScore)}`)); break; }
      case '/theme': console.log(setAgyTheme(arg, ['wsl', 'win'])); break;
      case '/eval': { const { report } = await new OrchEvaluationSuite().runAll(); console.log(green(`eval done in ${report.totalDurationMs} ms; see eval/REPORT.md`)); break; }
      case '/ui': console.log(`run in another terminal:  orch ui --port ${this.port}`); break;
      default: console.log(red(`unknown command ${cmd}`) + dim('  (/help)'));
    }
  }
}
