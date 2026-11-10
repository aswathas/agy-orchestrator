import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryManager } from '../src/memory/manager.mjs';
import { TasteEngine } from '../src/taste/engine.mjs';

test('MemoryManager stores 3-tier memories, performs FTS5 + dense vector RRF search, and queries live claude-mem.db', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'orch-mem-'));
  const dbPath = join(tmp, 'orch-mem.db');
  const mgr = new MemoryManager({ dbPath });
  await mgr.init();

  // Store episodic & semantic memories
  await mgr.storeMemory({
    tier: 'global',
    category: 'architecture',
    title: 'WSL2 SQLite 9p Lock Fix',
    content: 'Use ?immutable=1 when reading claude-mem.db across the /mnt/c 9p boundary in WSL2.',
    tags: ['sqlite', 'wsl2', 'claude-mem'],
    salience: 1.5,
  });

  await mgr.storeMemory({
    tier: 'session',
    sessionId: 'sess-alpha',
    category: 'handoff',
    title: 'Topology UI Switchboard',
    content: 'Implemented live leader switching between Gemini 4 Argon and Claude Opus 5.5.',
    tags: ['ui', 'topology'],
    salience: 1.0,
  });

  // Hybrid RRF search on local orch-mem.db + live claude-mem.db
  const res = await mgr.searchHybrid('sqlite 9p immutable claude-mem', {
    limit: 5,
    includeClaudeMem: true,
  });

  assert.ok(Array.isArray(res.results));
  assert.ok(res.results.length >= 1);
  assert.equal(res.results[0].title, 'WSL2 SQLite 9p Lock Fix');
  assert.ok(res.results[0].rrfScore > 0);
  // Also verify claude-mem stats are reported
  assert.ok(typeof res.claudeMemCount === 'number');

  // Test session handoff storage & retrieval
  await mgr.saveHandoff('sess-alpha', {
    state: 'Completed Task 1 & Task 2',
    next: 'Build Bandit Skill Router',
    files: ['src/memory/manager.mjs'],
    open: 'None',
  });
  const ctx = await mgr.getSessionContext('sess-alpha');
  assert.equal(ctx.handoff.next, 'Build Bandit Skill Router');
});

test('TasteEngine loads profile, compiles [USER TASTE CONTRACT], and scores agent output', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'orch-taste-'));
  const tastePath = join(tmp, 'taste-profile.json');
  const engine = new TasteEngine(tastePath);

  const profile = engine.loadProfile();
  assert.equal(profile.coding.ponytailLevel, 'ultra');
  assert.equal(profile.ui.archetype, 'industrial-brutalist-tactical-telemetry');

  const contract = engine.compileTasteContract();
  assert.ok(contract.includes('[USER TASTE CONTRACT]'));
  assert.ok(contract.includes('ponytail:ultra'));

  const goodScore = engine.scoreOutput('Clean minimal implementation with 1px CSS grid and #0A0A0A substrate.');
  const badScore = engine.scoreOutput('// TODO: implement rest of code here ... [truncated]');
  assert.ok(goodScore.score > badScore.score);
  assert.ok(badScore.violations.length > 0);
});
