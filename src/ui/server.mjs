import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGY_MODEL_CATALOG, VALID_SURFACES } from '../topology/controller.mjs';
import { getAgyThemesStatus, setAgyTheme } from '../adapters/path-bridge.mjs';
import { runBrain } from '../adapters/index.mjs';
import { OrchEvaluationSuite } from '../eval/benchmark.mjs';
import { StudioManager } from '../studio/session.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, 'index.html');
const EVAL_RESULTS_PATH = join(__dirname, '..', '..', 'eval', 'results.json');

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString('utf8');
      if (body.length > 5 * 1024 * 1024) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload));
}

export async function startDashboardServer({
  engine,
  phoneBridge,
  port = 4888,
  host = '127.0.0.1',
}) {
  const sseClients = new Set();
  const studio = new StudioManager({ engine });

  const onEngineEvent = (ev) => {
    const msg = `data: ${JSON.stringify(ev)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(msg);
      } catch {
        sseClients.delete(client);
      }
    }
  };
  engine.events.on('event', onEngineEvent);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }

    try {
      if (req.method === 'GET' && (path === '/' || path === '/index.html' || path === '/mobile')) {
        const html = readFileSync(HTML_PATH, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(html);
      }

      if (req.method === 'GET' && path === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });
        res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      if (req.method === 'GET' && path === '/api/state') {
        const topology = engine.topology.load();
        const taste = engine.taste.loadProfile();
        const tasteContract = engine.taste.compileTasteContract();
        const memStats = await engine.memory.getStats();
        const bandit = engine.learning.getBanditStats();
        const themes = getAgyThemesStatus();
        const phone = phoneBridge ? phoneBridge.status() : null;
        let evalReport = null;
        if (existsSync(EVAL_RESULTS_PATH)) {
          try {
            evalReport = JSON.parse(readFileSync(EVAL_RESULTS_PATH, 'utf8'));
          } catch {
            evalReport = null;
          }
        }
        return sendJson(res, 200, {
          ok: true,
          topology,
          catalog: AGY_MODEL_CATALOG,
          surfaces: VALID_SURFACES,
          taste,
          tasteContract,
          memory: memStats,
          bandit,
          themes,
          phone,
          evalReport,
          skillsCount: engine.router.catalog.length,
          skillsSample: engine.router.catalog.slice(0, 310).map((s) => ({
            name: s.name,
            folderName: s.folderName,
            description: s.description.slice(0, 160),
          })),
        });
      }

      if (req.method === 'POST' && path === '/api/topology') {
        const body = await readBody(req);
        let updated;
        if (body.action === 'set-leader') {
          updated = engine.topology.setLeader(body.spec, { effort: body.effort, role: body.role });
        } else if (body.action === 'set-role') {
          updated = engine.topology.setRole(body.roleKey, body.spec, { effort: body.effort });
        } else if (body.action === 'swap') {
          updated = engine.topology.swapLeaderWithSubagent(body.subagentId);
        } else if (body.action === 'upsert-worker') {
          updated = engine.topology.upsertWorker(body.id, body.spec, {
            effort: body.effort,
            specialties: body.specialties,
          });
        } else if (body.action === 'remove-worker') {
          updated = engine.topology.removeWorker(body.id);
        } else if (body.action === 'update-policies') {
          updated = engine.topology.updatePolicies(body.policies || {});
        } else {
          throw new Error(`Unknown topology action: ${body.action}`);
        }
        engine.emitEvent('topology_updated', { action: body.action, leader: updated.leader });
        return sendJson(res, 200, { ok: true, topology: updated });
      }

      if (req.method === 'POST' && path === '/api/run') {
        const body = await readBody(req);
        const result = await engine.executeTask(body.prompt || '', {
          mode: body.mode || null,
          sessionId: body.sessionId || null,
          forceLeader: body.forceLeader || null,
          dryRun: Boolean(body.dryRun),
        });
        return sendJson(res, 200, result);
      }

      if (req.method === 'POST' && path === '/api/ask') {
        const body = await readBody(req);
        const resBrain = await runBrain({
          surface: body.surface || 'agy-wsl',
          model: body.model || 'gemini-4-argon-medium',
          effort: body.effort || 'medium',
          prompt: body.prompt || '',
          dryRun: Boolean(body.dryRun),
        });
        return sendJson(res, 200, resBrain);
      }

      if (req.method === 'POST' && path === '/api/memory/search') {
        const body = await readBody(req);
        const searchRes = await engine.memory.searchHybrid(body.query || '', {
          limit: Number(body.limit || 10),
          includeClaudeMem: body.includeClaudeMem !== false,
        });
        return sendJson(res, 200, searchRes);
      }

      if (req.method === 'POST' && path === '/api/memory/store') {
        const body = await readBody(req);
        const stored = await engine.memory.storeMemory({
          tier: body.tier || 'global',
          sessionId: body.sessionId || 'global',
          category: body.category || 'architecture',
          title: body.title || 'Pinned Fact',
          content: body.content || '',
          tags: body.tags || [],
          salience: Number(body.salience || 1.2),
        });
        return sendJson(res, 200, stored);
      }

      if (req.method === 'POST' && path === '/api/skills/route') {
        const body = await readBody(req);
        const routed = engine.router.routeTask(body.prompt || '', {
          topology: engine.topology.load(),
          maxSkills: Number(body.maxSkills || 5),
        });
        return sendJson(res, 200, { ok: true, ...routed });
      }

      if (req.method === 'POST' && path === '/api/skills/install') {
        const body = await readBody(req);
        if (body.synthesize) {
          const syn = engine.router.synthesizeSkill({
            name: body.name,
            description: body.description,
            instructions: body.instructions,
          });
          return sendJson(res, 200, syn);
        }
        const inst = await engine.router.installMissingSkill(body.query);
        return sendJson(res, 200, inst);
      }

      if (req.method === 'POST' && path === '/api/taste') {
        const body = await readBody(req);
        if (body.addRule) {
          const updated = engine.taste.addRule(body.addRule);
          return sendJson(res, 200, { ok: true, taste: updated });
        }
        const updated = engine.taste.updateProfile(body.patch || {});
        return sendJson(res, 200, { ok: true, taste: updated });
      }

      if (req.method === 'POST' && path === '/api/learn') {
        const body = await readBody(req);
        if (body.action === 'consolidate') {
          const cons = engine.learning.consolidateRules();
          return sendJson(res, 200, cons);
        }
        if (body.rejected && body.chosen) {
          const rec = engine.learning.recordContrastivePair({
            cluster: body.cluster || 'general',
            rejected: body.rejected,
            chosen: body.chosen,
            rootCause: body.rootCause || 'User preference override',
            utility: Number(body.utility || 0.95),
          });
          const cons = engine.learning.consolidateRules();
          return sendJson(res, 200, { ok: true, record: rec, consolidated: cons });
        }
        if (body.correction) {
          engine.taste.addRule(body.correction);
          return sendJson(res, 200, { ok: true, taste: engine.taste.loadProfile() });
        }
        return sendJson(res, 400, { ok: false, error: 'Missing learning payload' });
      }

      if (req.method === 'POST' && path === '/api/theme') {
        const body = await readBody(req);
        const applied = setAgyTheme(body.scheme, body.targets || ['wsl', 'win']);
        return sendJson(res, 200, { ok: true, applied, themes: getAgyThemesStatus() });
      }

      if (req.method === 'POST' && path === '/api/phone') {
        const body = await readBody(req);
        if (!phoneBridge) return sendJson(res, 400, { ok: false, error: 'Phone bridge not attached' });
        if (body.action === 'process-inbox') {
          const resInbox = await phoneBridge.processInboxFile();
          return sendJson(res, 200, { ok: true, ...resInbox, status: phoneBridge.status() });
        }
        if (body.action === 'update-config') {
          phoneBridge.updateConfig(body.config || {});
          return sendJson(res, 200, { ok: true, status: phoneBridge.status() });
        }
        if (body.action === 'remote-control') {
          const rc = await phoneBridge.toggleAgyRemoteControl(body.subcommand || 'status');
          return sendJson(res, 200, rc);
        }
        if (body.action === 'notify') {
          const n = await phoneBridge.sendPhoneNotification(body.title || 'Orch Alert', body.message || '');
          return sendJson(res, 200, n);
        }
        return sendJson(res, 200, { ok: true, status: phoneBridge.status() });
      }

      if (req.method === 'POST' && path === '/api/improvise') {
        const body = await readBody(req);
        const imp = await engine.improviseSelf(body.featureRequest || '', {
          dryRun: Boolean(body.dryRun),
        });
        return sendJson(res, 200, imp);
      }

      if (path.startsWith('/preview/')) {
        const [, , sid, ...rest] = path.split('/');
        const out = studio.servePreview(sid, rest.length ? '/' + rest.join('/') : '/');
        res.writeHead(out.status, { 'Content-Type': out.type, 'Cache-Control': 'no-store' });
        return res.end(out.body);
      }

      if (path === '/api/studio/sessions' && req.method === 'GET') {
        return sendJson(res, 200, { ok: true, sessions: studio.list() });
      }
      if (path === '/api/studio/start' && req.method === 'POST') {
        const b = await readBody(req);
        if (!String(b.prompt || '').trim()) throw new Error('prompt required');
        return sendJson(res, 200, { ok: true, session: studio.start(b.prompt.trim(), { dryRun: b.dryRun !== false, mode: b.mode || 'egm' }) });
      }
      const sm = path.match(/^\/api\/studio\/(st-[a-z0-9]+)(?:\/(answer|approve|chat))?$/);
      if (sm) {
        const [, sid, action] = sm;
        if (req.method === 'GET' && !action) return sendJson(res, 200, { ok: true, session: studio.get(sid) });
        if (req.method === 'POST') {
          const b = await readBody(req);
          const session =
            action === 'answer' ? studio.answer(sid, b.answers)
            : action === 'approve' ? studio.approve(sid)
            : action === 'chat' ? studio.chat(sid, String(b.message || '').trim())
            : null;
          if (session) return sendJson(res, 200, { ok: true, session });
        }
      }

      if ((req.method === 'GET' || req.method === 'POST') && path === '/api/eval') {
        if (req.method === 'GET' && existsSync(EVAL_RESULTS_PATH)) {
          return sendJson(res, 200, {
            ok: true,
            report: JSON.parse(readFileSync(EVAL_RESULTS_PATH, 'utf8')),
          });
        }
        engine.emitEvent('eval_started', { timestamp: new Date().toISOString() });
        const suite = new OrchEvaluationSuite();
        const { report } = await suite.runAll();
        engine.emitEvent('eval_completed', { timestamp: new Date().toISOString(), durationMs: report.totalDurationMs });
        return sendJson(res, 200, { ok: true, report });
      }

      if ((req.method === 'GET' || req.method === 'POST') && path === '/api/phone/inbox') {
        const cfg = phoneBridge ? phoneBridge.loadConfig() : null;
        const inboxPath =
          cfg?.channels?.cloudNotesInbox?.inboxPath ||
          join(__dirname, '..', '..', 'memory', 'Phone-Inbox.md');
        if (req.method === 'POST') {
          const body = await readBody(req);
          if (body.addTask) {
            const cur = existsSync(inboxPath) ? readFileSync(inboxPath, 'utf8') : '# Phone Inbox\n\n## Tasks\n';
            const next = cur.trimEnd() + `\n- [ ] ${body.addTask.trim()}\n`;
            writeFileSync(inboxPath, next, 'utf8');
          } else if (typeof body.rawContent === 'string') {
            writeFileSync(inboxPath, body.rawContent, 'utf8');
          }
        }
        const rawContent = existsSync(inboxPath) ? readFileSync(inboxPath, 'utf8') : '';
        return sendJson(res, 200, { ok: true, inboxPath, rawContent });
      }

      return sendJson(res, 404, { ok: false, error: `Not found: ${path}` });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({
        server,
        port: addr.port,
        host: addr.address,
        close: () =>
          new Promise((resClose) => {
            engine.events.off('event', onEngineEvent);
            for (const c of sseClients) c.end();
            server.close(() => resClose());
          }),
      });
    });
  });
}
