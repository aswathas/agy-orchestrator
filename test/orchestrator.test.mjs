import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBrainCommand, runBrain } from '../src/adapters/index.mjs';
import { OrchestratorEngine } from '../src/orchestrator/engine.mjs';

test('buildBrainCommand constructs exact headless commands for agy-wsl, agy-win, cmdc, and mcode', () => {
  const wslCmd = buildBrainCommand({
    surface: 'agy-wsl',
    model: 'gemini-4-argon-high',
    effort: 'high',
    prompt: 'Analyze architecture',
  });
  assert.equal(wslCmd.bin, '/home/aswath/.local/bin/agy');
  assert.ok(wslCmd.args.includes('--model'));
  assert.ok(wslCmd.args.includes('gemini-4-argon-high'));
  assert.ok(wslCmd.args.includes('--dangerously-skip-permissions'));

  const winCmd = buildBrainCommand({
    surface: 'agy-win',
    model: 'claude-opus-5-5-high',
    effort: 'high',
    prompt: 'Review Windows code',
  });
  assert.equal(winCmd.bin, 'cmd.exe');
  assert.ok(winCmd.args.some((a) => a.includes('agy.exe')));

  const cmdcCmd = buildBrainCommand({
    surface: 'cmdc',
    model: 'default',
    prompt: 'Check taste',
    skills: ['/home/aswath/.agents/skills/ponytail/SKILL.md'],
  });
  assert.ok(cmdcCmd.args.includes('-p'));
  assert.ok(cmdcCmd.args.includes('--yolo'));

  const mcodeCmd = buildBrainCommand({
    surface: 'mcode',
    model: 'default',
    prompt: 'Fast edit',
  });
  assert.equal(mcodeCmd.bin, '/home/aswath/.minimax-code/bin/mcode');
  assert.equal(mcodeCmd.args[0], 'exec');
});

test('OrchestratorEngine executes full multi-agent pipeline (Route -> Memory -> Leader -> Dual-Category Workers -> Goldfish Review -> Learn)', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'orch-engine-'));
  const engine = new OrchestratorEngine({
    topologyPath: join(tmp, 'topology.json'),
    dbPath: join(tmp, 'orch-mem.db'),
    tastePath: join(tmp, 'taste.json'),
    ledgerPath: join(tmp, 'records.jsonl'),
    banditPath: join(tmp, 'bandit.json'),
  });
  await engine.init();

  const streamedEvents = [];
  engine.events.on('event', (ev) => streamedEvents.push(ev));

  const res = await engine.executeTask(
    'Design and implement a cross-OS Windows and WSL file watcher with industrial brutalist UI',
    { mode: 'egm', dryRun: true, sessionId: 'test-session-1' }
  );

  assert.equal(res.ok, true);
  assert.equal(res.mode, 'egm');
  assert.ok(res.routing.selectedSkills.length >= 1);
  assert.ok(res.steps.length >= 3, 'Expected Elephant Plan + Subagent Workers + Goldfish Review');
  assert.ok(streamedEvents.some((e) => e.type === 'task_started'));
  assert.ok(streamedEvents.some((e) => e.type === 'task_completed'));
});
