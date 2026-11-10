import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { ensureBridgeDir, toWinPath, WIN_HOME_WIN } from './path-bridge.mjs';

export const BINARIES = {
  'agy-wsl': '/home/aswath/.local/bin/agy',
  'agy-win': 'C:\\Users\\aswat\\AppData\\Local\\agy\\bin\\agy.exe',
  cmdc: '/mnt/c/Users/aswat/AppData/Roaming/npm/cmdc',
  cmdcWin: 'C:\\Users\\aswat\\AppData\\Roaming\\npm\\cmdc.cmd',
  mcode: '/home/aswath/.minimax-code/bin/mcode',
};

export function buildBrainCommand({
  surface = 'agy-wsl',
  model = 'gemini-4-argon-medium',
  effort = 'medium',
  prompt = '',
  systemContext = '',
  skills = [],
  conversationId = null,
  cwd = '/home/aswath',
}) {
  const fullPrompt = systemContext
    ? `${systemContext}\n\n---\n\n[TASK]\n${prompt}`
    : prompt;

  if (surface === 'agy-wsl') {
    const args = ['-p', fullPrompt, '--output-format', 'text', '--dangerously-skip-permissions'];
    if (model && model !== 'default') {
      args.push('--model', model);
    }
    if (effort) {
      args.push('--effort', effort);
    }
    if (conversationId) {
      args.push('--conversation', conversationId);
    }
    return {
      bin: BINARIES['agy-wsl'],
      args,
      cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'aswath',
        GIT_COMMITTER_NAME: 'aswath',
      },
    };
  }

  if (surface === 'agy-win') {
    const bridge = ensureBridgeDir();
    const promptId = `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.txt`;
    const wslPromptFile = join(bridge.wslPath, promptId);
    writeFileSync(wslPromptFile, fullPrompt, 'utf8');
    const winPromptFile = `${bridge.winPath}\\${promptId}`;

    // Use PowerShell via cmd.exe or direct PowerShell to read prompt file cleanly without cmd escaping limits
    const modelArg = model && model !== 'default' ? `--model "${model}"` : '';
    const effortArg = effort ? `--effort ${effort}` : '';
    const psScript = `$p = Get-Content -Raw -Encoding UTF8 '${winPromptFile}'; & '${BINARIES['agy-win']}' -p $p ${modelArg} ${effortArg} --output-format text --dangerously-skip-permissions`;
    return {
      bin: 'cmd.exe',
      args: ['/d', '/s', '/c', `cd /d ${WIN_HOME_WIN} && powershell.exe -NoProfile -Command "${psScript}"`],
      cwd: '/mnt/c/Users/aswat',
      env: process.env,
    };
  }

  if (surface === 'cmdc') {
    const args = ['-p', fullPrompt, '--yolo', '--skip-onboarding', '--output-format', 'text'];
    if (model && model !== 'default') {
      args.push('-m', model);
    }
    if (effort) {
      args.push('--effort', effort);
    }
    for (const sk of skills) {
      const skillDir = sk.endsWith('SKILL.md') ? dirname(sk) : sk;
      args.push('--skill', skillDir);
    }
    return {
      bin: BINARIES.cmdc,
      args,
      cwd,
      env: process.env,
    };
  }

  if (surface === 'mcode') {
    const bridge = ensureBridgeDir();
    const args = ['exec'];
    if (model && model !== 'default') {
      args.push('-m', model);
    }
    if (systemContext) {
      const sysFile = join(bridge.wslPath, `mcode-sys-${Date.now()}.md`);
      writeFileSync(sysFile, systemContext, 'utf8');
      args.push('--append-system-prompt-file', sysFile);
    }
    args.push(prompt);
    return {
      bin: BINARIES.mcode,
      args,
      cwd,
      env: process.env,
    };
  }

  throw new Error(`Unsupported brain surface: ${surface}`);
}

export async function runBrain({
  surface = 'agy-wsl',
  model = 'gemini-4-argon-medium',
  effort = 'medium',
  prompt = '',
  systemContext = '',
  skills = [],
  conversationId = null,
  cwd = '/home/aswath',
  timeoutMs = 180000,
  onStream = null,
  dryRun = false,
}) {
  const startTime = Date.now();
  const cmdSpec = buildBrainCommand({
    surface,
    model,
    effort,
    prompt,
    systemContext,
    skills,
    conversationId,
    cwd,
  });

  if (dryRun) {
    const simulated = `[DRY-RUN ${surface}:${model} (${effort})] Executed prompt (${prompt.slice(0, 80)}...) with ${skills.length} skill(s).`;
    if (onStream) onStream(simulated);
    return {
      ok: true,
      surface,
      model,
      output: simulated,
      latencyMs: Date.now() - startTime + 12,
      commandPreview: `${cmdSpec.bin} ${cmdSpec.args.slice(0, 4).join(' ')} ...`,
    };
  }

  return new Promise((resolve) => {
    const child = spawn(cmdSpec.bin, cmdSpec.args, {
      cwd: cmdSpec.cwd,
      env: cmdSpec.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      const str = chunk.toString('utf8');
      stdout += str;
      if (onStream) onStream(str);
    });

    child.stderr.on('data', (chunk) => {
      const str = chunk.toString('utf8');
      stderr += str;
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        surface,
        model,
        output: stdout,
        error: err.message,
        latencyMs: Date.now() - startTime,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const cleaned = stdout.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
      resolve({
        ok: code === 0 && !timedOut,
        exitCode: code,
        surface,
        model,
        output: cleaned || stderr.trim(),
        error: code !== 0 || timedOut ? (timedOut ? 'Timeout exceeded' : stderr.trim() || `Exited ${code}`) : null,
        latencyMs: Date.now() - startTime,
      });
    });
  });
}
