#!/usr/bin/env node
import readline from 'node:readline';
import { OrchestratorEngine } from '../src/orchestrator/engine.mjs';
import { PhoneAutomationBridge } from '../src/automation/phone-bridge.mjs';
import { startDashboardServer } from '../src/ui/server.mjs';
import { getAgyThemesStatus, setAgyTheme } from '../src/adapters/path-bridge.mjs';
import { parseAgentSpec } from '../src/topology/controller.mjs';
import { runBrain } from '../src/adapters/index.mjs';

const args = process.argv.slice(2);
const cmd = args[0] || 'status';

function hasFlag(flag) {
  return args.includes(flag);
}

function getFlag(flag, fallback = null) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

async function main() {
  const engine = new OrchestratorEngine();
  await engine.init();
  const phoneBridge = new PhoneAutomationBridge({ engine });

  if (cmd === 'status' || cmd === 'roster') {
    const topo = engine.topology.load();
    const memStats = await engine.memory.getStats();
    const themes = getAgyThemesStatus();
    const bandit = engine.learning.getBanditStats();
    if (hasFlag('--json')) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            topology: topo,
            memory: memStats,
            themes,
            skillsIndexed: engine.router.catalog.length,
            bandit,
          },
          null,
          2
        )
      );
      return;
    }
    console.log('==============================================================');
    console.log(' ORCH® // AGY MULTI-SURFACE & DUAL-CATEGORY HARNESS STATUS');
    console.log('==============================================================');
    console.log(` MAIN LEADER     : ${topo.leader.surface} :: ${topo.leader.model} [${topo.leader.category}] (effort=${topo.leader.effort})`);
    console.log(` GOLDFISH CRITIC : ${topo.goldfishCritic.surface} :: ${topo.goldfishCritic.model} [${topo.goldfishCritic.category}]`);
    console.log(` THINKING ROUTER : ${topo.router.surface} :: ${topo.router.model} (${engine.router.catalog.length} skills indexed)`);
    console.log(` HYBRID MEMORY   : ${memStats.claudeMemObservations} claude-mem obs + ${memStats.localMemories} orch-mem items`);
    console.log(` AGY CLI THEME   : WSL="${themes.wsl}" | WIN="${themes.win}"`);
    console.log('--------------------------------------------------------------');
    console.log(' SUBAGENT WORKER POOL:');
    for (const [id, w] of Object.entries(topo.subagents)) {
      console.log(`  - ${id.padEnd(18)} : ${w.surface}:${w.model} [${w.category}] (${(w.specialties || []).join(', ')})`);
    }
    console.log('==============================================================');
    return;
  }

  if (cmd === 'set-leader' || cmd === 'leader') {
    const spec = args[1];
    if (!spec) {
      console.error('Usage: orch set-leader <surface>:<model> [--effort low|medium|high|xhigh|max]');
      process.exit(1);
    }
    const effort = getFlag('--effort', 'high');
    const updated = engine.topology.setLeader(spec, { effort });
    console.log(`Updated Main Leader -> ${updated.leader.surface}:${updated.leader.model} (${updated.leader.category}, effort=${updated.leader.effort})`);
    console.log(`Auto-aligned Goldfish Critic -> ${updated.goldfishCritic.surface}:${updated.goldfishCritic.model}`);
    return;
  }

  if (cmd === 'swap') {
    const subId = args[1];
    if (!subId) {
      console.error('Usage: orch swap <subagentId>');
      process.exit(1);
    }
    const updated = engine.topology.swapLeaderWithSubagent(subId);
    console.log(`Swapped Leader with [${subId}] -> Active Leader is now ${updated.leader.surface}:${updated.leader.model}`);
    return;
  }

  if (cmd === 'worker') {
    const subCmd = args[1];
    if (subCmd === 'set' || subCmd === 'add') {
      const id = args[2];
      const spec = args[3];
      const specialties = (getFlag('--specialties', 'general') || 'general').split(',').map((s) => s.trim());
      const effort = getFlag('--effort', 'medium');
      const updated = engine.topology.upsertWorker(id, spec, { specialties, effort });
      console.log(`Upserted worker [${id}] -> ${updated.subagents[id].surface}:${updated.subagents[id].model}`);
      return;
    }
    if (subCmd === 'rm' || subCmd === 'remove') {
      const id = args[2];
      engine.topology.removeWorker(id);
      console.log(`Removed worker [${id}]`);
      return;
    }
  }

  if (cmd === 'route') {
    const prompt = args.slice(1).filter((a) => !a.startsWith('--')).join(' ');
    const routed = engine.router.routeTask(prompt, {
      topology: engine.topology.load(),
      maxSkills: 5,
    });
    if (hasFlag('--install') && routed.needsSkillInstall) {
      await engine.router.installMissingSkill(prompt.split(/\s+/)[0]);
    }
    console.log(JSON.stringify(routed, null, 2));
    return;
  }

  if (cmd === 'run') {
    const prompt = args.slice(1).filter((a) => !a.startsWith('--')).join(' ');
    if (!prompt) {
      console.error('Usage: orch run "<task>" [--mode full|egm|single] [--leader surface:model] [--session id] [--dry-run]');
      process.exit(1);
    }
    const mode = getFlag('--mode', null);
    const sessionId = getFlag('--session', null);
    const forceLeader = getFlag('--leader', null);
    const dryRun = hasFlag('--dry-run');

    engine.events.on('event', (ev) => {
      if (ev.type === 'step_started') {
        console.log(`\n>>> [${ev.step.toUpperCase()}] ${ev.agentId} (${ev.surface}:${ev.model})...`);
      }
    });

    const res = await engine.executeTask(prompt, {
      mode,
      sessionId,
      forceLeader,
      dryRun,
    });
    console.log('\n=== FINAL ORCHESTRATED OUTPUT ===\n');
    console.log(res.finalOutput);
    return;
  }

  if (cmd === 'ask') {
    const target = args[1] || 'leader';
    const prompt = args.slice(2).filter((a) => !a.startsWith('--')).join(' ');
    const topo = engine.topology.load();
    let spec;
    if (target === 'leader') spec = topo.leader;
    else if (topo.subagents[target]) spec = topo.subagents[target];
    else spec = parseAgentSpec(target);

    const res = await runBrain({
      surface: spec.surface,
      model: spec.model,
      effort: spec.effort || 'medium',
      prompt,
      dryRun: hasFlag('--dry-run'),
    });
    console.log(res.output || res.error);
    return;
  }

  if (cmd === 'memory') {
    const sub = args[1] || 'stats';
    if (sub === 'search') {
      const q = args.slice(2).join(' ');
      const res = await engine.memory.searchHybrid(q, { limit: 8, includeClaudeMem: true });
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    if (sub === 'add') {
      const title = args[2] || 'Fact';
      const content = args.slice(3).join(' ');
      const res = await engine.memory.storeMemory({ tier: 'global', title, content });
      console.log('Stored memory:', res);
      return;
    }
    console.log(JSON.stringify(await engine.memory.getStats(), null, 2));
    return;
  }

  if (cmd === 'taste') {
    const sub = args[1] || 'show';
    if (sub === 'add') {
      const rule = args.slice(2).join(' ');
      const updated = engine.taste.addRule(rule);
      console.log('Updated taste rules:', updated.customRules);
      return;
    }
    console.log(engine.taste.compileTasteContract());
    return;
  }

  if (cmd === 'learn') {
    const feedback = args.slice(1).join(' ');
    if (feedback) {
      engine.taste.addRule(`[Learned Feedback] ${feedback}`);
      await engine.memory.storeMemory({
        tier: 'global',
        category: 'learning_feedback',
        title: feedback.slice(0, 80),
        content: feedback,
        salience: 1.5,
      });
      console.log('Recorded feedback into Taste Contract & Hybrid Memory.');
      return;
    }
    console.log(JSON.stringify(engine.learning.getBanditStats(), null, 2));
    return;
  }

  if (cmd === 'theme') {
    const scheme = args.slice(1).join(' ').trim();
    if (!scheme || scheme === 'list') {
      console.log(JSON.stringify(getAgyThemesStatus(), null, 2));
      return;
    }
    const updated = setAgyTheme(scheme, ['wsl', 'win']);
    console.log('Applied AGY theme across WSL & Windows:', updated);
    return;
  }

  if (cmd === 'phone' || cmd === 'phone-daemon') {
    const sub = args[1] || 'scan';
    if (sub === 'scan') {
      const r = await phoneBridge.processInboxFile();
      console.log('Phone Inbox scan result:', r);
      return;
    }
    console.log('Starting Phone & Cloud Notes Automation Daemon...');
    phoneBridge.start();
    return;
  }

  if (cmd === 'ui' || cmd === 'dashboard') {
    const port = Number(getFlag('--port', '4888'));
    const host = getFlag('--host', '0.0.0.0');
    phoneBridge.start();
    const srv = await startDashboardServer({ engine, phoneBridge, port, host });
    console.log(`ORCH Tactical Telemetry Web Control Center running at http://127.0.0.1:${srv.port}`);
    console.log(`Phone Automation Bridge active (watching /mnt/c/Users/aswat/OneDrive/Orch-Phone-Inbox.md & ntfy.sh)`);
    return;
  }

  if (cmd === 'repl') {
    console.log('ORCH Interactive Console — commands: status, leader <spec>, swap <id>, route <q>, run <task>, exit');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'orch> ' });
    rl.prompt();
    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (trimmed === 'exit' || trimmed === 'quit') {
        rl.close();
        process.exit(0);
      }
      if (trimmed.startsWith('leader ')) {
        const u = engine.topology.setLeader(trimmed.slice(7).trim());
        console.log(`Leader -> ${u.leader.surface}:${u.leader.model}`);
      } else if (trimmed.startsWith('swap ')) {
        const u = engine.topology.swapLeaderWithSubagent(trimmed.slice(5).trim());
        console.log(`Swapped Leader -> ${u.leader.surface}:${u.leader.model}`);
      } else if (trimmed.startsWith('route ')) {
        console.log(engine.router.routeTask(trimmed.slice(6).trim(), { topology: engine.topology.load() }));
      } else if (trimmed) {
        const r = await engine.executeTask(trimmed, { dryRun: false });
        console.log(r.finalOutput);
      }
      rl.prompt();
    });
    return;
  }

  console.log([
    'Usage: orch <command> [options]',
    'Commands:',
    '  status [--json]                        Show Leader, Subagents, Memory & Theme status',
    '  set-leader <surface>:<model>           Switch Main Leader (e.g. agy-wsl:claude-opus-5-5-high or agy-win:gemini-4-argon-high)',
    '  swap <subagentId>                      Swap Main Leader with a named subagent worker',
    '  worker set <id> <surface>:<model>      Add or modify a subagent worker',
    '  worker rm <id>                         Remove a subagent worker',
    '  route "<task>" [--install]             Run Two-Stage Thinking Skill Router & Bandit selector',
    '  run "<task>" [--mode full|egm|single]  Run full orchestrated workflow',
    '  ask <target> "<prompt>"                Query a specific role or surface:model directly',
    '  memory [stats|search <q>|add <t> <c>]  Query or add to 3-Tier MemGPT + claude-mem Hybrid Memory',
    '  taste [show|add "<rule>"]              Inspect or add rules to your Taste Contract',
    '  learn ["<correction>"]                 Record feedback or inspect Thompson Bandit posteriors',
    '  theme [list|<scheme>]                  Set AGY CLI theme across WSL & Windows',
    '  phone [scan|daemon]                    Scan or watch OneDrive/Phone Inbox & ntfy.sh',
    '  ui [--port 4888]                       Start Tactical Telemetry Web Control Center + Phone Daemon',
    '  repl                                   Interactive orchestrator shell',
  ].join('\n'));
}

main().catch((err) => {
  console.error('ORCH ERROR:', err.message);
  process.exit(1);
});
