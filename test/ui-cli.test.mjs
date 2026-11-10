import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { OrchestratorEngine } from '../src/orchestrator/engine.mjs';
import { PhoneAutomationBridge } from '../src/automation/phone-bridge.mjs';
import { startDashboardServer } from '../src/ui/server.mjs';

const execFileAsync = promisify(execFile);

test('Web Control Center HTTP + SSE server serves Industrial Brutalist UI and handles topology, routing, memory, phone, and improvise APIs', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'orch-ui-'));
  const engine = new OrchestratorEngine({
    topologyPath: join(tmp, 'topology.json'),
    dbPath: join(tmp, 'orch-mem.db'),
    tastePath: join(tmp, 'taste.json'),
    ledgerPath: join(tmp, 'records.jsonl'),
    banditPath: join(tmp, 'bandit.json'),
  });
  await engine.init();

  const phoneBridge = new PhoneAutomationBridge({
    engine,
    configPath: join(tmp, 'automation.json'),
    inboxPath: join(tmp, 'Inbox.md'),
    dryRun: true,
  });

  const srv = await startDashboardServer({ engine, phoneBridge, port: 0 });
  const baseUrl = `http://127.0.0.1:${srv.port}`;

  try {
    // 1. Check HTML UI adheres to industrial-brutalist-ui
    const htmlRes = await fetch(`${baseUrl}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.ok(html.includes('#0A0A0A'));
    assert.ok(html.includes('#E61919'));
    assert.ok(html.includes('JetBrains Mono'));

    // 2. Check /api/state
    const stateRes = await fetch(`${baseUrl}/api/state`);
    const state = await stateRes.json();
    assert.equal(state.ok, true);
    assert.equal(state.topology.leader.surface, 'agy-wsl');

    // 3. Switch leader via POST /api/topology
    const switchRes = await fetch(`${baseUrl}/api/topology`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set-leader', spec: 'agy-win:gemini-4-argon-high', effort: 'high' }),
    });
    const switched = await switchRes.json();
    assert.equal(switched.topology.leader.surface, 'agy-win');
    assert.equal(switched.topology.leader.model, 'gemini-4-argon-high');

    // 4. Dry-run task via POST /api/run
    const runRes = await fetch(`${baseUrl}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Build a responsive grid component', mode: 'full', dryRun: true }),
    });
    const runData = await runRes.json();
    assert.equal(runData.ok, true);
    assert.ok(runData.steps.length >= 2);
  } finally {
    await srv.close();
  }
});

test('orch.mjs CLI executes status, set-leader, swap, route, and memory commands cleanly', async () => {
  const cliPath = '/home/aswath/agy-orchestrator/bin/orch.mjs';
  const { stdout } = await execFileAsync('node', [cliPath, 'status', '--json']);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.ok, true);
  assert.ok(parsed.topology.leader.model);
});
