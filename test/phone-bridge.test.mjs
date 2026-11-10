import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrchestratorEngine } from '../src/orchestrator/engine.mjs';
import { PhoneAutomationBridge } from '../src/automation/phone-bridge.mjs';

test('PhoneAutomationBridge atomically processes unchecked tasks in cloud-synced markdown notes inbox without duplicate runs', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'orch-phone-'));
  const inboxPath = join(tmp, 'Orch-Phone-Inbox.md');
  writeFileSync(
    inboxPath,
    [
      '# Phone Automation Inbox',
      '- [ ] Check system status and summarize hybrid memory architecture',
      '- [x] Already finished task',
    ].join('\n') + '\n',
    'utf8'
  );

  const engine = new OrchestratorEngine({
    topologyPath: join(tmp, 'topology.json'),
    dbPath: join(tmp, 'orch-mem.db'),
    tastePath: join(tmp, 'taste.json'),
    ledgerPath: join(tmp, 'records.jsonl'),
    banditPath: join(tmp, 'bandit.json'),
  });
  await engine.init();

  const bridge = new PhoneAutomationBridge({
    engine,
    configPath: join(tmp, 'automation.json'),
    inboxPath,
    dryRun: true,
  });

  const processed = await bridge.processInboxFile(inboxPath);
  assert.equal(processed.executedCount, 1);

  const updatedMd = readFileSync(inboxPath, 'utf8');
  assert.ok(updatedMd.includes('- [x] Check system status and summarize hybrid memory architecture'));
  assert.ok(updatedMd.includes('> **Orch Result'));

  // Re-running on the same file should execute 0 tasks (idempotency guard)
  const secondRun = await bridge.processInboxFile(inboxPath);
  assert.equal(secondRun.executedCount, 0);
});
