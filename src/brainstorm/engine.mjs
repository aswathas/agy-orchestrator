import { runBrain } from '../adapters/index.mjs';

/**
 * Dynamic LLM-driven Brainstorming and Clarification Engine.
 * Uses the active Leader and system skills (`brainstorming`, `idea-refine`, `interview-me`)
 * to critically interview the user and surface non-trivial technical requirements.
 */
export class BrainstormEngine {
  constructor({ engine } = {}) {
    this.engine = engine;
  }

  async generateQuestions(prompt, { dryRun = true } = {}) {
    const topo = this.engine.topology.load();
    const leader = topo.leader;
    const taste = this.engine.taste.compileTasteContract();

    // Check if brainstorming skill exists
    const brainstormSkills = ['brainstorming', 'interview-me', 'idea-refine'];
    const mountedSkills = this.engine.router.catalog
      .filter((s) => brainstormSkills.includes(s.name))
      .map((s) => s.path);

    const systemPrompt = [
      `You are the Lead Architect for the ORCH Agentic Harness.`,
      `Your role is to brainstorm and conduct an interactive requirements interview before any code is written.`,
      taste,
      `Instructions:`,
      `1. Analyze the user's task request deeply.`,
      `2. Identify 3 to 5 critical architectural, operational, or trade-off decisions that MUST be answered before building.`,
      `3. Avoid superficial questions. Ask about technical constraints, data schemas, failure handling, UI aesthetics, or system interfaces.`,
      `4. Output strictly valid JSON matching this schema:`,
      `{`,
      `  "analysis": "2-sentence technical summary of the requirements problem space",`,
      `  "questions": [`,
      `    {`,
      `      "id": "short_unique_key",`,
      `      "text": "Specific, probing question",`,
      `      "options": ["Option A (trade-off)", "Option B (trade-off)", "Option C"],`,
      `      "default": "Option A (trade-off)",`,
      `      "free": false`,
      `    }`,
      `  ]`,
      `}`
    ].join('\n');

    if (dryRun) {
      // Deterministic feature-sensitive dynamic questions for simulated mode
      const { features } = this.engine.router.extractTaskFeatures(prompt);
      const questions = [
        {
          id: 'architecture_pattern',
          text: `Which architectural pattern fits best for "${prompt.slice(0, 45)}"?`,
          options: [
            'Event-Driven micro-module (reactive SSE/events)',
            'Layered Monolith (clean seams, single runtime)',
            'Stateless CLI Pipeline (STDIN/STDOUT Unix composability)',
            'Micro-Kernel with hot-pluggable extensions'
          ],
          default: features.frontend_ui
            ? 'Event-Driven micro-module (reactive SSE/events)'
            : 'Stateless CLI Pipeline (STDIN/STDOUT Unix composability)',
          free: false,
        },
        {
          id: 'concurrency_model',
          text: 'How should concurrency, background tasks, and locking be managed?',
          options: [
            'Worker thread pool with atomic mutex lock',
            'Non-blocking async event loop (Node.js/libuv)',
            'Dedicated child process IPC with timeout guards',
            'SQLite WAL mode single-writer serial queue'
          ],
          default: 'Non-blocking async event loop (Node.js/libuv)',
          free: false,
        },
        {
          id: 'error_recovery',
          text: 'What is the fallback strategy on edge-case failures or corrupt inputs?',
          options: [
            'Crash early with detailed diagnostic trace (Fail-Fast)',
            'Graceful degradation with fallback defaults',
            'Self-healing retry loop with exponential backoff',
            'Compensating transaction rollback'
          ],
          default: 'Self-healing retry loop with exponential backoff',
          free: false,
        }
      ];

      if (features.frontend_ui) {
        questions.push({
          id: 'visual_language',
          text: 'Which visual language and typography hierarchy should be enforced?',
          options: [
            'Industrial Brutalist (1px exposed grid, #FF4F00 orange accent, monospace numerals)',
            'Minimalist Editorial (Swiss typography, muted warm monotone, spacious flow)',
            'Terminal CRT Matrix (phosphor green #4AF626, pure obsidian, scanlines)',
            'Clean SaaS Modern (subtle borders, responsive cards)'
          ],
          default: 'Industrial Brutalist (1px exposed grid, #FF4F00 orange accent, monospace numerals)',
          free: false,
        });
      }

      questions.push({
        id: 'user_custom_spec',
        text: 'Any proprietary invariants, external APIs, or forbidden packages?',
        options: [],
        default: 'None',
        free: true,
      });

      return {
        analysis: `Dynamic requirements breakdown for task targeting ${features.frontend_ui ? 'UI/UX interface' : 'backend/cli systems'}.`,
        questions,
      };
    }

    // Call active leader via runBrain for live brainstorming
    const response = await runBrain({
      surface: leader.surface,
      model: leader.model,
      effort: 'high',
      systemContext: systemPrompt,
      prompt: `Analyze this user task and generate your 4-question brainstorming interview:\n${prompt}`,
      skills: mountedSkills,
      timeoutMs: 45000,
      dryRun: false,
    });

    try {
      const match = response.output.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed.questions) && parsed.questions.length > 0) {
          return parsed;
        }
      }
    } catch {
      // Fallback if model output isn't strict JSON
    }

    return {
      analysis: response.output.slice(0, 200),
      questions: [
        {
          id: 'core_strategy',
          text: 'What primary design trade-off should guide the implementation?',
          options: ['Maximum Performance', 'Maximum Simplicity (YAGNI/Ponytail)', 'Maximum Robustness & Typing'],
          default: 'Maximum Simplicity (YAGNI/Ponytail)',
          free: false,
        },
        {
          id: 'custom_notes',
          text: 'Additional technical specifications or constraints:',
          options: [],
          default: '',
          free: true,
        }
      ]
    };
  }
}
