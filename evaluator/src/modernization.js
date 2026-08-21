import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TIMEOUTS_MS } from './constants.js';
import { runAdapterCommand } from './commands.js';
import { parseCsv } from './csv.js';
import { createBaseEvidence, failDimension, finalizeEvidence, passDimension, setGate } from './evidence.js';
import { MODERNIZATION_BUSINESS_DATE, writeModernizationFixture } from './fixtures.js';
import { stringifyDeterministic } from './json.js';
import { resolveInside } from './paths.js';
import { validateModernizationAdapter } from './schema.js';
import { runStaticChecks } from './static-checks.js';

export async function evaluateModernization(candidateRoot, options) {
  const evidence = createBaseEvidence('modernization');
  const adapterPath = path.join(candidateRoot, 'benchmark-adapter.json');

  let adapter;
  try {
    adapter = JSON.parse(await fs.readFile(adapterPath, 'utf8'));
  } catch (error) {
    evidence.adapterValidation.errors.push(`Unable to read benchmark-adapter.json: ${error.message}`);
    return finalizeEvidence(evidence);
  }

  const validationErrors = validateModernizationAdapter(adapter);
  evidence.adapterValidation = {
    passed: validationErrors.length === 0,
    errors: validationErrors
  };
  if (validationErrors.length > 0) {
    return finalizeEvidence(evidence);
  }

  let workingDirectory;
  try {
    workingDirectory = resolveInside(candidateRoot, adapter.workingDirectory, 'workingDirectory');
  } catch (error) {
    evidence.adapterValidation.passed = false;
    evidence.adapterValidation.errors.push(error.message);
    return finalizeEvidence(evidence);
  }

  evidence.staticChecks = await runStaticChecks(candidateRoot, options.dotnetPath);
  setGate(evidence, 'no-critical-security-findings', evidence.staticChecks.blockingFindings === 0, `${evidence.staticChecks.blockingFindings} blocking static/dependency finding(s)`);

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sealed-modernization-'));
  const inputDirectory = path.join(tempRoot, 'input');
  const outputDirectory = path.join(tempRoot, 'output');
  await writeModernizationFixture(inputDirectory);
  await fs.mkdir(outputDirectory, { recursive: true });
  const boundOutputDirectory = await fs.realpath(outputDirectory);

  const substitutions = {
    businessDate: MODERNIZATION_BUSINESS_DATE,
    inputDirectory,
    outputDirectory
  };

  try {
    const build = await runAdapterCommand({
      id: 'build',
      command: adapter.build,
      cwd: workingDirectory,
      candidateRoot,
      substitutions,
      dotnetPath: options.dotnetPath,
      timeoutMs: TIMEOUTS_MS.build
    });
    evidence.commands.push(build);
    setGate(evidence, 'build', build.passed, build.passed ? 'build command completed with an allowed exit code' : 'build command failed or timed out');

    const test = await runAdapterCommand({
      id: 'test',
      command: adapter.test,
      cwd: workingDirectory,
      candidateRoot,
      substitutions,
      dotnetPath: options.dotnetPath,
      timeoutMs: TIMEOUTS_MS.test
    });
    evidence.commands.push(test);

    const run1 = await runAdapterCommand({
      id: 'run-hidden-fixture-1',
      command: adapter.run,
      cwd: workingDirectory,
      candidateRoot,
      substitutions,
      dotnetPath: options.dotnetPath,
      timeoutMs: TIMEOUTS_MS.run
    });
    evidence.commands.push(run1);

    const firstOutputs = await collectOutputs(
      outputDirectory,
      adapter.outputs,
      boundOutputDirectory
    );
    const run2 = await runAdapterCommand({
      id: 'run-hidden-fixture-2',
      command: adapter.run,
      cwd: workingDirectory,
      candidateRoot,
      substitutions,
      dotnetPath: options.dotnetPath,
      timeoutMs: TIMEOUTS_MS.run
    });
    evidence.commands.push(run2);
    const secondOutputs = await collectOutputs(
      outputDirectory,
      adapter.outputs,
      boundOutputDirectory
    );

    const checks = evaluateModernizationOutputs(firstOutputs, secondOutputs, run1, run2);
    if (!test.passed) {
      checks.failed.push('test command failed or timed out');
    }
    setGate(evidence, 'essential-business-invariants', checks.failed.length === 0, checks.failed.length === 0 ? 'all hidden business invariant checks passed' : checks.failed.join('; '));

    if (build.passed && test.passed && run1.passed && run2.passed && checks.failed.length === 0) {
      passDimension(evidence, 'functionalCorrectness', 'Hidden modernization fixture produced expected observable outcomes.');
      passDimension(evidence, 'behaviorPreservation', 'Legacy observable CSV contract and rerun behavior were preserved.');
      passDimension(evidence, 'operability', 'Build, test, and repeated run commands completed through adapter arrays.');
      passDimension(evidence, 'scopeTraceability', 'Adapter provided declared outputs for evaluator-owned hidden fixture.');
    } else {
      failDimension(evidence, 'functionalCorrectness', checks.failed.join('; ') || 'one or more adapter commands failed');
      failDimension(evidence, 'behaviorPreservation', 'legacy observable behavior was not fully preserved');
      failDimension(evidence, 'operability', 'build/test/run command sequence did not complete cleanly');
      failDimension(evidence, 'scopeTraceability', 'declared output contract was incomplete or invalid');
    }

    if (evidence.staticChecks.blockingFindings === 0) {
      passDimension(evidence, 'securityControls', 'No blocking pinned static/dependency findings were detected; this is not a security certification.');
    } else {
      failDimension(evidence, 'securityControls', 'Blocking pinned static/dependency findings were detected.');
    }

    passDimension(evidence, 'maintainability', 'Candidate exposed a schema-valid data-only benchmark adapter.');
  } catch (error) {
    evidence.dimensions.functionalCorrectness.findings.push(error.message);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }

  return finalizeEvidence(evidence);
}

export async function collectOutputs(
  outputDirectory,
  declaredOutputs,
  boundOutputDirectory = null
) {
  const files = {};
  const outputStat = await fs.lstat(outputDirectory);
  if (!outputStat.isDirectory() || outputStat.isSymbolicLink()) {
    throw new Error('Evaluator output directory was replaced with a link or non-directory');
  }
  const realOutputDirectory = await fs.realpath(outputDirectory);
  if (
    boundOutputDirectory !== null &&
    path.resolve(realOutputDirectory) !== path.resolve(boundOutputDirectory)
  ) {
    throw new Error('Evaluator output directory escaped its evaluator-owned location');
  }
  const containmentRoot = boundOutputDirectory ?? realOutputDirectory;
  for (const declared of declaredOutputs) {
    const relative = declared
      .replaceAll('{businessDate}', MODERNIZATION_BUSINESS_DATE)
      .replaceAll('\\', '/');
    const resolved = resolveInside(outputDirectory, relative, `declared output "${relative}"`);
    try {
      const realResolved = await fs.realpath(resolved);
      resolveInside(
        containmentRoot,
        realResolved,
        `declared output "${relative}" resolved path`
      );
      const fileStat = await fs.stat(realResolved);
      files[relative] = fileStat.isFile() ? await fs.readFile(realResolved, 'utf8') : null;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        files[relative] = null;
      } else {
        throw error;
      }
    }
  }
  return files;
}

export function evaluateModernizationOutputs(firstOutputs, secondOutputs, run1, run2) {
  const failed = [];
  const missing = Object.entries(firstOutputs).filter(([, content]) => content == null).map(([name]) => name);
  if (missing.length > 0) {
    failed.push(`missing declared output(s): ${missing.join(', ')}`);
  }

  if (stringifyDeterministic(firstOutputs) !== stringifyDeterministic(secondOutputs)) {
    failed.push('rerun outputs are not byte-stable through the declared output contract');
  }
  if (!run1.passed || !run2.passed) {
    failed.push('run command did not complete with stable allowed exit handling');
  }

  const matchedText = findOutput(firstOutputs, 'matched-trades.csv');
  const breakText = findOutput(firstOutputs, 'break-queue.csv');
  const reportText = findOutput(firstOutputs, 'end-of-day-report.txt') ?? findOutput(firstOutputs, 'eod-summary.txt') ?? '';

  const matched = matchedText ? parseCsv(matchedText) : [];
  const breaks = breakText ? parseCsv(breakText) : parseCanonicalBreakRegister(findOutput(firstOutputs, 'eod-break-register.csv'));

  requireCondition(failed, matched.some((row) => value(row, 'trade_id', 'TradeId') === 'T-NORM' && value(row, 'account', 'Account') === 'ACC-MIXED'), 'normalized identifiers were not visible in matched output');
  requireCondition(failed, breaks.some((row) => value(row, 'trade_id', 'TradeId') === 'T-DUP' && includesReason(row, 'DuplicateTradeId')), 'duplicate trade was not surfaced as a break');
  requireCondition(failed, matched.some((row) => value(row, 'trade_id', 'TradeId') === 'T-TOL-IN'), 'inclusive tolerance boundary did not match');
  requireCondition(failed, breaks.some((row) => value(row, 'trade_id', 'TradeId') === 'T-TOL-OUT' && includesReason(row, 'SettlementAmountOutOfTolerance')), 'out-of-tolerance amount was not broken');
  requireCondition(failed, breaks.some((row) => value(row, 'trade_id', 'TradeId') === 'T-MISSING-SET' && includesReason(row, 'MissingSettlement')), 'missing settlement was not broken');
  requireCondition(failed, breaks.some((row) => value(row, 'trade_id', 'TradeId') === 'T-MISSING-POS' && includesReason(row, 'MissingPosition')), 'missing position was not broken');
  requireCondition(failed, breaks.some((row) => value(row, 'trade_id', 'TradeId') === 'T-NONPOS' && includesReason(row, 'TradeValueOutOfBounds')), 'non-positive values were not rejected');
  requireCondition(failed, matched.some((row) => value(row, 'trade_id', 'TradeId') === 'T-OVR' && /ManualOverride/.test(value(row, 'status', 'Status'))), 'eligible manual override was not visible in matched output');
  requireCondition(failed, matched.some((row) => value(row, 'trade_id', 'TradeId') === 'T-OVR-DUP' && /ManualOverride/.test(value(row, 'status', 'Status'))) && /Stale Overrides|stale/i.test(reportText), 'duplicate override audit visibility was missing');
  requireCondition(failed, !breaks.some((row) => value(row, 'trade_id', 'TradeId') === 'T-OVR'), 'applied override remained open');

  return { failed };
}

function parseCanonicalBreakRegister(text) {
  if (!text) {
    return [];
  }
  return parseCsv(text).map((row) => ({
    TradeId: row.TradeId,
    Type: row.Type,
    Reasons: row.Type,
    Account: row.Account
  }));
}

function findOutput(outputs, basename) {
  const entry = Object.entries(outputs).find(([name]) => path.basename(name.replaceAll('\\', '/')) === basename);
  return entry ? entry[1] : null;
}

function value(row, ...keys) {
  for (const key of keys) {
    if (row[key] != null) {
      return row[key];
    }
  }
  return '';
}

function includesReason(row, reason) {
  return [value(row, 'reasons', 'Reasons'), value(row, 'Type')].some((text) => text.includes(reason));
}

function requireCondition(failed, condition, message) {
  if (!condition) {
    failed.push(message);
  }
}
