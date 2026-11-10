import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SkillRouter } from '../src/router/skill-router.mjs';
import { LearningLoop } from '../src/learning/loop.mjs';
import { TopologyController } from '../src/topology/controller.mjs';
import { TasteEngine } from '../src/taste/engine.mjs';

test('SkillRouter indexes ~/.agents/skills, routes tasks via hybrid BM25+vector similarity, and enforces dual-category Bandit selection', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'orch-router-'));
  const topo = new TopologyController(join(tmp, 'topology.json')).load();
  const learning = new LearningLoop({ ledgerPath: join(tmp, 'records.jsonl'), banditPath: join(tmp, 'bandit.json') });
  const router = new SkillRouter({ learningLoop: learning });

  const indexed = router.indexLocalSkills();
  assert.ok(indexed.count > 30, `Expected >30 skills indexed, got ${indexed.count}`);

  // Route a UI + GSAP animation task
  const routeRes = router.routeTask(
    'Build an industrial brutalist telemetry dashboard with GSAP scrolltrigger animations and strict layout grid',
    { topology: topo, maxSkills: 4 }
  );

  assert.ok(routeRes.selectedSkills.length >= 2);
  const skillNames = routeRes.selectedSkills.map((s) => s.name);
  assert.ok(
    skillNames.some((n) => n.includes('brutalist') || n.includes('gsap') || n.includes('design-taste')),
    `Expected UI/GSAP skill in ${skillNames.join(', ')}`
  );

  // Check complexity score & dual-category agent selection
  assert.ok(routeRes.complexityScore > 0.4);
  assert.ok(routeRes.agentPlan.selectedWorkers.length >= 2);
  const categories = new Set([
    routeRes.agentPlan.leader.category,
    ...routeRes.agentPlan.selectedWorkers.map((w) => w.category),
  ]);
  assert.ok(categories.has('gemini'), 'Plan must include a Gemini model');
  assert.ok(categories.has('claude-gpt'), 'Plan must include a Claude/GPT model');
});

test('LearningLoop updates Thompson Sampling Beta posteriors and consolidates contrastive DPO pairs into Taste rules', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'orch-learn-'));
  const taste = new TasteEngine(join(tmp, 'taste.json'));
  const learning = new LearningLoop({
    ledgerPath: join(tmp, 'records.jsonl'),
    banditPath: join(tmp, 'bandit.json'),
    tasteEngine: taste,
  });

  // Record positive outcome for gemini-architect
  learning.recordOutcome({
    task: 'Design hybrid memory schema',
    agentId: 'gemini-architect',
    surface: 'agy-wsl',
    model: 'gemini-4-argon-high',
    category: 'gemini',
    skills: ['codebase-design'],
    success: true,
    latencyMs: 4200,
    tasteScore: 0.98,
  });

  const stats = learning.getBanditStats();
  assert.ok(stats.arms['gemini-architect'].alpha > 1.0);

  // Record contrastive DPO pair and consolidate into Taste
  learning.recordContrastivePair({
    cluster: 'windows-cli-cwd',
    rejected: 'Spawn cmd.exe from \\\\wsl.localhost\\Ubuntu\\home\\aswath',
    chosen: 'Spawn cmd.exe from C:\\Users\\aswat and pass translated path',
    rootCause: 'cmd.exe rejects UNC paths as current working directory',
    utility: 0.95,
  });

  const consolidated = learning.consolidateRules();
  assert.ok(consolidated.promotedRules.length >= 1);
  const updatedTaste = taste.loadProfile();
  assert.ok(updatedTaste.customRules.some((r) => r.includes('cmd.exe rejects UNC paths')));
});
