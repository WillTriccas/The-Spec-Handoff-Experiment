import { spawn } from 'node:child_process';
import path from 'node:path';
import { hasPathSeparator, resolveInside, toPosixRelative } from './paths.js';

const OUTPUT_LIMIT = 24_000;

export async function runAdapterCommand({
  id,
  command,
  cwd,
  candidateRoot,
  substitutions,
  dotnetPath,
  timeoutMs
}) {
  const executable = resolveExecutable(command.executable, cwd, candidateRoot, dotnetPath);
  const argumentsList = command.arguments.map((argument) => substitute(argument, substitutions));
  const scrubbers = [
    candidateRoot,
    substitutions.inputDirectory,
    substitutions.outputDirectory,
    substitutions.stateDirectory,
    substitutions.exportPath,
    substitutions.accountSentinel,
    substitutions.amountSentinel
  ];
  const result = await spawnCommand(executable, argumentsList, {
    cwd,
    timeoutMs,
    scrubbers,
    sensitiveValues: [
      substitutions.accountSentinel,
      substitutions.amountSentinel
    ].filter(Boolean)
  });
  const passed = command.allowedExitCodes.includes(result.exitCode) && !result.timedOut;
  return {
    ...result,
    allowedExitCodes: [...command.allowedExitCodes].sort((a, b) => a - b),
    arguments: argumentsList.map((argument) => scrubMany(argument, scrubbers)),
    cwd: toPosixRelative(candidateRoot, cwd) || '.',
    executable: scrub(executable, candidateRoot),
    id,
    passed,
    sensitiveOutputDetected: result.sensitiveOutputDetected
  };
}

export async function spawnCommand(executable, argumentsList, options = {}) {
  const { cwd, timeoutMs, scrubbers = [], sensitiveValues = [] } = options;
  return await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let sensitiveOutputDetected = false;
    let stdoutScanTail = '';
    let stderrScanTail = '';
    const longestSensitiveValue = Math.max(0, ...sensitiveValues.map((value) => value.length));
    const scanSensitive = (text, stream) => {
      const tail = stream === 'stdout' ? stdoutScanTail : stderrScanTail;
      const combined = `${tail}${text}`;
      sensitiveOutputDetected ||= sensitiveValues.some((value) => combined.includes(value));
      const nextTail =
        longestSensitiveValue > 1
          ? combined.slice(-(longestSensitiveValue - 1))
          : '';
      if (stream === 'stdout') stdoutScanTail = nextTail;
      else stderrScanTail = nextTail;
    };
    const child = spawn(executable, argumentsList, {
      cwd,
      detached: process.platform !== 'win32',
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      scanSensitive(text, 'stdout');
      stdout = limit(`${stdout}${text}`);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      scanSensitive(text, 'stderr');
      stderr = limit(`${stderr}${text}`);
    });
    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: null,
        signal: null,
        timedOut,
        sensitiveOutputDetected,
        stdout: '',
        stderr: scrubMany(error.message, scrubbers)
      });
    });
    child.on('close', (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: code,
        signal,
        timedOut,
        sensitiveOutputDetected,
        stdout: scrubMany(normalizeOutput(stdout), scrubbers),
        stderr: scrubMany(normalizeOutput(stderr), scrubbers)
      });
    });
  });
}

function terminateProcessTree(child) {
  if (child.pid == null) {
    return;
  }

  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore'
    });
    killer.on('error', () => {
      child.kill('SIGKILL');
    });
    return;
  }

  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

function resolveExecutable(executable, cwd, candidateRoot, dotnetPath) {
  const substitutedDotnet = dotnetPath && executable.toLowerCase() === 'dotnet';
  const value = substitutedDotnet ? dotnetPath : executable;

  if (path.isAbsolute(value)) {
    return path.resolve(value);
  }

  if (!hasPathSeparator(value)) {
    if (value.toLowerCase() === 'dotnet') {
      return value;
    }
    throw new Error(`Only dotnet may be resolved from PATH; executable must be an absolute path or candidate-relative path: ${value}`);
  }

  return resolveInside(cwd, value, 'command executable');
}

export function substitute(value, substitutions) {
  return value.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => {
    if (!(key in substitutions)) {
      throw new Error(`Unknown adapter placeholder: ${match}`);
    }
    return substitutions[key] == null ? '' : String(substitutions[key]);
  });
}

function normalizeOutput(value) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function limit(value) {
  return value.length <= OUTPUT_LIMIT ? value : `${value.slice(0, OUTPUT_LIMIT)}\n...[truncated]`;
}

function scrubMany(value, scrubbers) {
  return scrubbers.reduce((current, scrubber) => scrub(current, scrubber), value);
}

function scrub(value, scrubber) {
  if (!scrubber) {
    return value;
  }
  const raw = String(scrubber);
  const normalized = path.resolve(String(scrubber));
  return String(value)
    .split(raw).join('<redacted-path>')
    .split(raw.replaceAll('\\', '/')).join('<redacted-path>')
    .split(normalized).join('<redacted-path>')
    .split(normalized.replaceAll('\\', '/')).join('<redacted-path>');
}
