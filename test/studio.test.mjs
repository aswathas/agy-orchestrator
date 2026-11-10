import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OrchestratorEngine } from '../src/orchestrator/engine.mjs';
import { StudioManager } from '../src/studio/session.mjs';

const until = (fn, ms = 20000) =>
  new Promise((resolve, reject) => {
    const t0 = Date.now();
    const i = setInterval(() => {
      if (fn()) { clearInterval(i); resolve(); }
      else if (Date.now() - t0 > ms) { clearInterval(i); reject(new Error('timeout')); }
    }, 50);
  });

test('Studio: clarify -> plan -> approve -> build -> preview -> chat change, with safe preview serving', async () => {
  const engine = new OrchestratorEngine();
  await engine.init();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-studio-'));
  const studio = new StudioManager({ engine, dir });

  const s = await studio.start('Build a dashboard UI for my repos', { dryRun: true, mode: 'single' });
  assert.equal(s.state, 'clarifying');
  assert.ok(s.questions.some((q) => q.id === 'visual_language'), 'UI task must ask a visual design question');

  studio.answer(s.id, { architecture_pattern: 'Layered Monolith' });
  assert.equal(s.state, 'awaiting_approval');
  assert.match(s.spec, /architecture_pattern:\*\* Layered Monolith/);
  assert.throws(() => studio.approve('st-nope'), /Unknown/);

  studio.chat(s.id, 'make it dark only');
  assert.equal(s.revision, 2, 'chat during approval regenerates the plan');
  assert.match(s.spec, /dark only/);

  studio.approve(s.id);
  assert.equal(s.state, 'building');
  await until(() => s.state === 'preview');
  assert.equal(s.progressPct, 100);
  assert.ok(s.plan.every((p) => p.status === 'done'));

  const page = studio.servePreview(s.id, '/');
  assert.equal(page.status, 200);
  assert.match(String(page.body), /LIVE BUILD PREVIEW/);
  assert.equal(studio.servePreview(s.id, '/../../session.json').status, 403);

  fs.writeFileSync(path.join(dir, s.id, 'workspace', 'index.html'), '<h1>real app</h1>');
  assert.match(String(studio.servePreview(s.id, '/').body), /real app/);

  studio.chat(s.id, 'add a footer');
  assert.equal(s.state, 'building');
  await until(() => s.state === 'preview');
  assert.equal(s.runs.length, 2);
});
