import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { OrchEvaluationSuite } from '../src/eval/benchmark.mjs';

test('OrchEvaluationSuite runs all 5 quantitative ablations and achieves target accuracy & lock invariants', async () => {
  const suite = new OrchEvaluationSuite();
  const { report, jsonPath, mdPath } = await suite.runAll();

  assert.ok(fs.existsSync(jsonPath), 'eval/results.json should be written');
  assert.ok(fs.existsSync(mdPath), 'eval/REPORT.md should be written');

  // 1. Memory Ablation: Hybrid RRF must outperform Naive Substring and achieve >= 0.95 MRR
  const mem = report.memory.strategies;
  assert.ok(
    mem.hybrid_rrf_ebbinghaus.mrr > mem.naive_substring_json.mrr,
    'Hybrid RRF MRR must beat Naive Substring JSON baseline'
  );
  assert.equal(mem.hybrid_rrf_ebbinghaus.recallAt1, 1.0);

  // 2. Skill Router & Bandit: Post-DPO Top-1 accuracy must improve over Zero-Shot and save >95% tokens
  assert.ok(report.router.totalIndexedSkills >= 180, 'Should index >= 180 local skills');
  assert.ok(
    report.router.postDpoTop1Accuracy >= report.router.zeroShotTop1Accuracy,
    'Post-DPO Bandit Top-1 accuracy must improve or equal Zero-Shot'
  );
  assert.equal(report.router.postDpoTop1Accuracy, 1.0);
  assert.ok(report.router.contextTokenReductionPct > 99.0);

  // 3. Topology Cross-Category Invariant
  assert.equal(report.topology.crossFamilyInvariantRate, 1.0);

  // 4. Taste Classifier F1
  assert.equal(report.taste.f1Score, 1.0);

  // 5. Phone Concurrency Stress Test: 0 duplicate executions
  assert.equal(report.phone.duplicateExecutions, 0);
  assert.equal(report.phone.atomicLockIntegrityPct, 100.0);
});
