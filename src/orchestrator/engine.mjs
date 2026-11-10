import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TopologyController } from '../topology/controller.mjs';
import { MemoryManager } from '../memory/manager.mjs';
import { TasteEngine } from '../taste/engine.mjs';
import { SkillRouter } from '../router/skill-router.mjs';
import { LearningLoop } from '../learning/loop.mjs';
import { runBrain } from '../adapters/index.mjs';

const execFileAsync = promisify(execFile);

export class OrchestratorEngine {
  constructor({
    topologyPath,
    dbPath,
    tastePath,
    ledgerPath,
    banditPath,
    skillDirs,
  } = {}) {
    this.topology = new TopologyController(topologyPath);
    this.memory = new MemoryManager({ dbPath });
    this.taste = new TasteEngine(tastePath);
    this.learning = new LearningLoop({
      ledgerPath,
      banditPath,
      tasteEngine: this.taste,
      memoryManager: this.memory,
    });
    this.router = new SkillRouter({ skillDirs, learningLoop: this.learning });
    this.events = new EventEmitter();
    this.activeRuns = new Map();
  }

  async init() {
    const memStatus = await this.memory.init();
    const skillIndex = this.router.indexLocalSkills();
    const topo = this.topology.load();
    const taste = this.taste.loadProfile();
    return {
      ok: true,
      memory: memStatus,
      skillsIndexed: skillIndex.count,
      leader: topo.leader,
      tasteUser: taste.user,
    };
  }

  emitEvent(type, payload = {}) {
    const ev = {
      id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      type,
      ...payload,
    };
    this.events.emit('event', ev);
    return ev;
  }

  async executeTask(
    prompt,
    {
      mode = null,
      sessionId = null,
      forceLeader = null,
      cwd = '/home/aswath',
      dryRun = false,
      timeoutMs = 180000,
    } = {}
  ) {
    const runId = `run-${Date.now()}`;
    const topo = this.topology.load();
    const sid = sessionId || topo.activeSessionId || 'default';

    if (forceLeader) {
      this.topology.setLeader(forceLeader);
    }
    const activeTopo = this.topology.load();

    this.emitEvent('task_started', {
      runId,
      sessionId: sid,
      prompt,
      leader: activeTopo.leader,
    });

    // 1. Route task & select skills + bandit agents
    const routing = this.router.routeTask(prompt, {
      topology: activeTopo,
      maxSkills: 3,
    });

    const effectiveMode =
      mode ||
      (activeTopo.policies.defaultExecutionMode === 'adaptive'
        ? routing.complexityScore >= (activeTopo.policies.complexityGateThreshold || 0.4)
          ? 'full'
          : 'single'
        : activeTopo.policies.defaultExecutionMode);

    this.emitEvent('routing_completed', {
      runId,
      mode: effectiveMode,
      complexityScore: routing.complexityScore,
      selectedSkills: routing.selectedSkills.map((s) => s.name),
      selectedWorkers: routing.agentPlan.selectedWorkers.map((w) => ({
        id: w.id,
        surface: w.surface,
        model: w.model,
        category: w.category,
        theta: w.banditTheta,
      })),
    });

    // 2. Retrieve Hybrid RRF Memory (orch-mem + claude-mem.db) & Taste Contract
    const hybridMem = await this.memory.searchHybrid(prompt, {
      limit: 6,
      includeClaudeMem: true,
      sessionId: sid,
    });
    const tasteContract = activeTopo.policies.enableTasteInjection
      ? this.taste.compileTasteContract()
      : '';
    const skillInstructions = routing.selectedSkills
      .map((s) => this.router.loadSkillInstructions(s, 1800))
      .join('\n\n');
    const memoryContext = (hybridMem.results || [])
      .map((m) => `- [${m.source}:${m.category}] ${m.title}: ${m.content.slice(0, 260)}`)
      .join('\n');

    const sharedSystemContext = [
      tasteContract,
      memoryContext ? `\n[HYBRID MEMORY (RRF Top Matches)]\n${memoryContext}` : '',
      skillInstructions ? `\n[MOUNTED SKILLS]\n${skillInstructions}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const steps = [];
    this.activeRuns.set(runId, { runId, prompt, mode: effectiveMode, status: 'running', steps });

    // 3. Step A: Main Leader Execution / Planning
    const leaderSpec = activeTopo.leader;
    this.emitEvent('step_started', {
      runId,
      step: 'leader',
      agentId: leaderSpec.id,
      surface: leaderSpec.surface,
      model: leaderSpec.model,
      category: leaderSpec.category,
    });

    const leaderPrompt =
      effectiveMode === 'single'
        ? prompt
        : `You are the Main Orchestrator Leader (${leaderSpec.surface}:${leaderSpec.model}).\nTask: ${prompt}\n\nProvide a clear architectural plan and implementation breakdown for the subagent pool (${routing.agentPlan.selectedWorkers.map((w) => `${w.id}[${w.surface}:${w.model}]`).join(', ')}).`;

    const leaderRes = await runBrain({
      surface: leaderSpec.surface,
      model: leaderSpec.model,
      effort: leaderSpec.effort,
      prompt: leaderPrompt,
      systemContext: sharedSystemContext,
      skills: routing.selectedSkills.map((s) => s.path),
      cwd,
      timeoutMs,
      dryRun,
      onStream: (chunk) =>
        this.emitEvent('stream_chunk', { runId, step: 'leader', agentId: leaderSpec.id, chunk }),
    });

    const leaderTaste = this.taste.scoreOutput(leaderRes.output);
    this.learning.recordOutcome({
      task: prompt,
      agentId: leaderSpec.id,
      surface: leaderSpec.surface,
      model: leaderSpec.model,
      category: leaderSpec.category,
      skills: routing.selectedSkills.map((s) => s.name),
      success: leaderRes.ok,
      latencyMs: leaderRes.latencyMs,
      tasteScore: leaderTaste.score,
      error: leaderRes.error,
    });

    steps.push({
      role: 'leader',
      agentId: leaderSpec.id,
      surface: leaderSpec.surface,
      model: leaderSpec.model,
      category: leaderSpec.category,
      ok: leaderRes.ok,
      latencyMs: leaderRes.latencyMs,
      tasteScore: leaderTaste.score,
      output: leaderRes.output,
    });

    this.emitEvent('step_completed', {
      runId,
      step: 'leader',
      agentId: leaderSpec.id,
      ok: leaderRes.ok,
      latencyMs: leaderRes.latencyMs,
    });

    // 4. Step B: Dual-Category Subagent Execution (for 'full' or 'egm' modes)
    if (effectiveMode === 'full' || effectiveMode === 'egm') {
      const workers = routing.agentPlan.selectedWorkers.slice(0, activeTopo.policies.maxSubagentConcurrency || 2);
      const workerPromises = workers.map(async (w) => {
        this.emitEvent('step_started', {
          runId,
          step: 'subagent',
          agentId: w.id,
          surface: w.surface,
          model: w.model,
          category: w.category,
        });

        const subPrompt = `Leader Plan:\n${leaderRes.output.slice(0, 2000)}\n\nExecute your assigned specialty (${(w.specialties || []).join(', ')}) for task:\n${prompt}`;
        const wRes = await runBrain({
          surface: w.surface,
          model: w.model,
          effort: w.effort,
          prompt: subPrompt,
          systemContext: sharedSystemContext,
          skills: routing.selectedSkills.map((s) => s.path),
          cwd,
          timeoutMs,
          dryRun,
          onStream: (chunk) =>
            this.emitEvent('stream_chunk', { runId, step: 'subagent', agentId: w.id, chunk }),
        });

        const wTaste = this.taste.scoreOutput(wRes.output);
        this.learning.recordOutcome({
          task: prompt,
          agentId: w.id,
          surface: w.surface,
          model: w.model,
          category: w.category,
          skills: routing.selectedSkills.map((s) => s.name),
          success: wRes.ok,
          latencyMs: wRes.latencyMs,
          tasteScore: wTaste.score,
          error: wRes.error,
        });

        this.emitEvent('step_completed', {
          runId,
          step: 'subagent',
          agentId: w.id,
          ok: wRes.ok,
          latencyMs: wRes.latencyMs,
        });

        return {
          role: 'subagent',
          agentId: w.id,
          surface: w.surface,
          model: w.model,
          category: w.category,
          ok: wRes.ok,
          latencyMs: wRes.latencyMs,
          tasteScore: wTaste.score,
          output: wRes.output,
        };
      });

      const workerResults = await Promise.all(workerPromises);
      steps.push(...workerResults);
    }

    // 5. Step C: Fresh-Context EGM Goldfish Critic (if mode === 'egm')
    if (effectiveMode === 'egm') {
      const critic = activeTopo.goldfishCritic;
      this.emitEvent('step_started', {
        runId,
        step: 'goldfish-critic',
        agentId: critic.id,
        surface: critic.surface,
        model: critic.model,
        category: critic.category,
      });

      // Goldfish rule: receives ONLY the draft/output and task, without earlier conversational bias
      const combinedDraft = steps.map((s) => `[${s.agentId} (${s.model})]:\n${s.output}`).join('\n\n');
      const goldfishPrompt = [
        'You are an EGM Goldfish Reviewer running in a fresh context with zero prior conversation bias.',
        'Stress-test the following draft across Contrarian/YAGNI, WSL/Windows boundary risks, and Completeness.',
        'Lead with what is wrong, missing, or risky. No sycophancy.',
        `\nTask: ${prompt}\n\nDraft Output:\n${combinedDraft.slice(0, 4000)}`,
      ].join('\n');

      const cRes = await runBrain({
        surface: critic.surface,
        model: critic.model,
        effort: critic.effort,
        prompt: goldfishPrompt,
        systemContext: tasteContract,
        skills: [],
        cwd,
        timeoutMs,
        dryRun,
        onStream: (chunk) =>
          this.emitEvent('stream_chunk', { runId, step: 'goldfish-critic', agentId: critic.id, chunk }),
      });

      steps.push({
        role: 'goldfish-critic',
        agentId: critic.id,
        surface: critic.surface,
        model: critic.model,
        category: critic.category,
        ok: cRes.ok,
        latencyMs: cRes.latencyMs,
        output: cRes.output,
      });

      this.emitEvent('step_completed', {
        runId,
        step: 'goldfish-critic',
        agentId: critic.id,
        ok: cRes.ok,
        latencyMs: cRes.latencyMs,
      });
    }

    // 6. Store episodic summary in Hybrid Memory & Session Handoff
    const finalSummary = steps.map((s) => `[${s.role}:${s.agentId} (${s.surface}:${s.model})]\n${s.output}`).join('\n\n---\n\n');
    await this.memory.storeMemory({
      tier: 'session',
      sessionId: sid,
      category: 'execution_trace',
      title: prompt.slice(0, 90),
      content: finalSummary.slice(0, 2000),
      tags: routing.selectedSkills.map((s) => s.name),
      salience: 1.1,
    });

    await this.memory.saveHandoff(sid, {
      state: `Completed (${effectiveMode}) via Leader ${leaderSpec.surface}:${leaderSpec.model}`,
      next: 'Ready for next command or follow-up',
      files: [],
      open: 'None',
    });

    this.activeRuns.delete(runId);
    this.emitEvent('task_completed', {
      runId,
      sessionId: sid,
      mode: effectiveMode,
      stepsCount: steps.length,
    });

    return {
      ok: steps.every((s) => s.ok),
      runId,
      sessionId: sid,
      mode: effectiveMode,
      routing,
      memoryHits: hybridMem.results?.length || 0,
      steps,
      finalOutput: finalSummary,
    };
  }

  async improviseSelf(featureRequest, { dryRun = false } = {}) {
    const repoRoot = '/home/aswath/agy-orchestrator';
    let checkpointCommit = null;
    try {
      await execFileAsync('git', ['add', '-A'], { cwd: repoRoot });
      await execFileAsync(
        'git',
        ['commit', '-m', `chore(checkpoint): pre-improvise snapshot before "${featureRequest.slice(0, 50)}"`],
        { cwd: repoRoot }
      );
      const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot });
      checkpointCommit = stdout.trim();
    } catch {
      // Working tree clean or no changes to commit
    }

    const res = await this.executeTask(
      `Self-Improvise Orchestrator Harness at ${repoRoot}: ${featureRequest}. Preserve all existing tests and follow ponytail:ultra.`,
      { mode: 'full', cwd: repoRoot, dryRun }
    );

    return {
      ...res,
      checkpointCommit,
    };
  }
}
