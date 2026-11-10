import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toWinPath, toWslPath, SUPPORTED_AGY_THEMES } from '../src/adapters/path-bridge.mjs';
import { TopologyController, AGY_MODEL_CATALOG } from '../src/topology/controller.mjs';

test('path-bridge translates WSL <-> Windows paths accurately', () => {
  assert.equal(toWinPath('/mnt/c/Users/aswat/Projects/foo'), 'C:\\Users\\aswat\\Projects\\foo');
  assert.equal(toWslPath('C:\\Users\\aswat\\Projects\\foo'), '/mnt/c/Users/aswat/Projects/foo');
  assert.ok(SUPPORTED_AGY_THEMES.includes('tokyo night'));
  assert.ok(SUPPORTED_AGY_THEMES.includes('solarized dark'));
});

test('TopologyController supports live leader switching, role swapping, and dual-category model enforcement', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'orch-topo-'));
  const topoPath = join(tmp, 'topology.json');
  const ctrl = new TopologyController(topoPath);

  const initial = ctrl.load();
  assert.equal(initial.leader.surface, 'agy-wsl');
  assert.ok(AGY_MODEL_CATALOG.gemini.length >= 6);
  assert.ok(AGY_MODEL_CATALOG['claude-gpt'].length >= 7);

  // Switch leader to Windows Gemini 4 Argon High
  const updated = ctrl.setLeader('agy-win:gemini-4-argon-high', { effort: 'high' });
  assert.equal(updated.leader.surface, 'agy-win');
  assert.equal(updated.leader.model, 'gemini-4-argon-high');
  assert.equal(updated.leader.category, 'gemini');

  // Swap leader with subagent 'claude-coder'
  const swapped = ctrl.swapLeaderWithSubagent('claude-coder');
  assert.equal(swapped.leader.model, 'claude-sonnet-5-5-high');
  assert.equal(swapped.subagents['claude-coder'].model, 'gemini-4-argon-high');

  // Upsert custom worker (e.g. cmdc or mcode)
  const withWorker = ctrl.upsertWorker('cmdc-taste', 'cmdc:default', {
    specialties: ['taste', 'refactor'],
  });
  assert.equal(withWorker.subagents['cmdc-taste'].surface, 'cmdc');

  // Remove worker
  const afterRm = ctrl.removeWorker('cmdc-taste');
  assert.equal(afterRm.subagents['cmdc-taste'], undefined);
});
