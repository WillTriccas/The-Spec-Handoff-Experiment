import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnCommand } from './commands.js';
import { TIMEOUTS_MS } from './constants.js';
import { tryParseJson } from './json.js';

const EVALUATOR_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS_PROJECT = path.join(
  EVALUATOR_ROOT,
  'harness',
  'TradeRecon.OverrideHarness',
  'TradeRecon.OverrideHarness.csproj'
);

function commandEvidence(id, result, passed) {
  return {
    ...result,
    id,
    passed,
    allowedExitCodes: id.endsWith('-build') ? [0] : [0, 2],
    executable: 'dotnet',
    arguments: [],
    cwd: '<sealed-evaluator>'
  };
}

export async function runOverrideSuppressionHarness({
  candidateRoot,
  fixtureDirectory,
  businessDate,
  temporaryRoot,
  dotnetPath = 'dotnet'
}) {
  const outputRoot = path.join(temporaryRoot, 'override-harness');
  const commonOptions = {
    cwd: EVALUATOR_ROOT,
    timeoutMs: TIMEOUTS_MS.build,
    scrubbers: [candidateRoot, fixtureDirectory, temporaryRoot],
    sensitiveValues: []
  };
  const buildResult = await spawnCommand(
    dotnetPath,
    [
      'build',
      HARNESS_PROJECT,
      '--configuration',
      'Release',
      '--nologo',
      `-p:CandidateRoot=${candidateRoot}`,
      `-p:HarnessOutputRoot=${outputRoot}`
    ],
    commonOptions
  );
  const build = commandEvidence(
    'override-suppression-harness-build',
    buildResult,
    buildResult.exitCode === 0 && !buildResult.timedOut
  );
  if (!build.passed) {
    return {
      passed: false,
      build,
      execution: null,
      evidence: null,
      failure: 'evaluator-owned override suppression harness did not build against the candidate'
    };
  }

  const harnessDll = path.join(
    outputRoot,
    'bin',
    'Release',
    'net8.0',
    'TradeRecon.OverrideHarness.dll'
  );
  const executionResult = await spawnCommand(
    dotnetPath,
    [
      harnessDll,
      '--date',
      businessDate,
      '--fixtures',
      fixtureDirectory
    ],
    {
      ...commonOptions,
      timeoutMs: TIMEOUTS_MS.run
    }
  );
  const parsed = tryParseJson(executionResult.stdout);
  const execution = commandEvidence(
    'override-suppression-harness',
    executionResult,
    [0, 2].includes(executionResult.exitCode) && !executionResult.timedOut
  );
  const passed =
    execution.exitCode === 0 &&
    parsed?.passed === true &&
    parsed?.suppressedBreakStatus === 'Overridden' &&
    parsed?.idempotent === true;
  return {
    passed,
    build,
    execution,
    evidence: parsed,
    failure: passed
      ? null
      : parsed?.failures?.join('; ') ||
        'override suppression harness did not positively prove suppression and idempotency'
  };
}
