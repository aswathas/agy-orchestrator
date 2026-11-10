import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OrchestratorEngine } from '../src/orchestrator/engine.mjs';
import { StudioManager } from '../src/studio/session.mjs';
import { WorkspaceDiffEngine } from '../src/studio/diff.mjs';
import { HookManager } from '../src/hooks/manager.mjs';

const until = (fn, ms = 20000) =>
  new Promise((resolve, reject) => {
    const t0 = Date.now();
    const i = setInterval(() => {
      if (fn()) { clearInterval(i); resolve(); }
      else if (Date.now() - t0 > ms) { clearInterval(i); reject(new Error('timeout')); }
    }, 50);
  });

test('WorkspaceDiffEngine: scans files, detects additions/modifications/deletions accurately', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-diff-'));
  const engine = new WorkspaceDiffEngine(dir);

  assert.deepEqual(engine.scanTree(), []);

  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log("hello");\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'util.js'), 'export const x = 1;\n');

  const tree = engine.scanTree();
  assert.equal(tree.length, 2);

  const snap1 = engine.takeSnapshot();
  assert.equal(Object.keys(snap1).length, 2);

  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log("hello world");\nconsole.log("line2");\n');
  fs.unlinkSync(path.join(dir, 'src', 'util.js'));
  fs.writeFileSync(path.join(dir, 'config.json'), '{"ok": true}\n');

  const snap2 = engine.takeSnapshot();
  const diffs = engine.computeDiff(snap1, snap2);

  assert.equal(diffs.length, 3);
  const mod = diffs.find((d) => d.file === 'app.js');
  assert.equal(mod.type, 'modified');
  const del = diffs.find((d) => d.file === 'src/util.js');
  assert.equal(del.type, 'deleted');
  const add = diffs.find((d) => d.file === 'config.json');
  assert.equal(add.type, 'created');
});

test('HookManager: triggers registered lifecycle hooks and logs execution history', async () => {
  const hookFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-hooks-')), 'hooks.json');
  const mgr = new HookManager({ configPath: hookFile });

  let called = false;
  mgr.register('pre-route', async (p) => {
    called = true;
    return { ok: true, task: p.task };
  });

  const res = await mgr.trigger('pre-route', { task: 'test-hook' });
  assert.equal(called, true);
  assert.equal(res.length >= 1, true);
  assert.equal(mgr.history.length >= 1, true);
});

test('StudioManager: dynamic LLM brainstorm questions, diff generation and step-mode gating', async () => {
  const engine = new OrchestratorEngine();
  await engine.init();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-studio-v2-'));
  const studio = new StudioManager({ engine, dir });

  // 1. Start session with dynamic brainstorming questions
  const s = await studio.start('Build a high-performance event bus with worker pools', {
    dryRun: true,
    stepMode: 'continuous',
  });

  assert.equal(s.state, 'clarifying');
  assert.ok(s.questions.length >= 3, 'Must produce dynamic questions');
  assert.ok(s.questions.some((q) => q.id === 'architecture_pattern'), 'Should question architecture pattern');

  // 2. Answer and transition to plan approval
  studio.answer(s.id, { architecture_pattern: 'Micro-Kernel with hot-pluggable extensions' });
  assert.equal(s.state, 'awaiting_approval');
  assert.match(s.spec, /Micro-Kernel/);

  // 3. Test step-mode switching
  studio.setStepMode(s.id, 'step-by-step');
  assert.equal(s.stepMode, 'step-by-step');

  // 4. Approve and check diff generation
  studio.approve(s.id);
  assert.equal(s.state, 'building');

  await until(() => s.state === 'preview');
  assert.equal(s.progressPct, 100);
  assert.ok(Array.isArray(s.diffs));
});
