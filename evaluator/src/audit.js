import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { TIMEOUTS_MS } from './constants.js';
import { runAdapterCommand } from './commands.js';
import { createBaseEvidence, failDimension, finalizeEvidence, passDimension, setGate } from './evidence.js';
import { AUDIT_SYNTHETIC_VALUES, MODERNIZATION_BUSINESS_DATE, writeModernizationFixture } from './fixtures.js';
import { tryParseJson } from './json.js';
import { collectOutputs, evaluateModernizationOutputs } from './modernization.js';
import { resolveInside } from './paths.js';
import { validateAuditAdapter, validateModernizationAdapter } from './schema.js';
import { runStaticChecks } from './static-checks.js';

export async function evaluateAuditFeature(candidateRoot, options) {
  const evidence = createBaseEvidence('audit-feature');
  const adapterPath = path.join(candidateRoot, 'audit-adapter.json');
  const benchmarkAdapterPath = path.join(candidateRoot, 'benchmark-adapter.json');

  let adapter;
  let benchmarkAdapter;
  try {
    adapter = JSON.parse(await fs.readFile(adapterPath, 'utf8'));
  } catch (error) {
    evidence.adapterValidation.errors.push(`Unable to read audit-adapter.json: ${error.message}`);
    return finalizeEvidence(evidence);
  }
  try {
    benchmarkAdapter = JSON.parse(await fs.readFile(benchmarkAdapterPath, 'utf8'));
  } catch (error) {
    evidence.adapterValidation.errors.push(`Unable to read benchmark-adapter.json: ${error.message}`);
    return finalizeEvidence(evidence);
  }

  const validationErrors = [
    ...validateAuditAdapter(adapter).map((error) => `audit-adapter: ${error}`),
    ...validateModernizationAdapter(benchmarkAdapter).map((error) => `benchmark-adapter: ${error}`)
  ];
  evidence.adapterValidation = {
    passed: validationErrors.length === 0,
    errors: validationErrors
  };
  if (validationErrors.length > 0) {
    return finalizeEvidence(evidence);
  }

  let workingDirectory;
  let benchmarkWorkingDirectory;
  try {
    workingDirectory = resolveInside(candidateRoot, adapter.workingDirectory, 'workingDirectory');
    benchmarkWorkingDirectory = resolveInside(candidateRoot, benchmarkAdapter.workingDirectory, 'benchmark workingDirectory');
  } catch (error) {
    evidence.adapterValidation.passed = false;
    evidence.adapterValidation.errors.push(error.message);
    return finalizeEvidence(evidence);
  }

  evidence.staticChecks = await runStaticChecks(candidateRoot, options.dotnetPath);
  setGate(evidence, 'no-critical-security-findings', evidence.staticChecks.blockingFindings === 0, `${evidence.staticChecks.blockingFindings} blocking static/dependency finding(s)`);
  setGate(evidence, 'build', true, 'audit adapter is command-based and schema-valid');

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sealed-audit-'));
  const inputDirectory = path.join(tempRoot, 'input');
  const outputDirectory = path.join(tempRoot, 'output');
  const stateDirectory = path.join(tempRoot, 'state');
  const exportPath = path.join(tempRoot, 'export.json');
  await writeModernizationFixture(inputDirectory);
  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.mkdir(stateDirectory, { recursive: true });
  const boundOutputDirectory = await fs.realpath(outputDirectory);

  const baseSubstitutions = {
    businessDate: MODERNIZATION_BUSINESS_DATE,
    inputDirectory,
    outputDirectory,
    stateDirectory,
    exportPath,
    accountSentinel: AUDIT_SYNTHETIC_VALUES.accountSentinel,
    amountSentinel: AUDIT_SYNTHETIC_VALUES.amountSentinel,
    proposer: AUDIT_SYNTHETIC_VALUES.proposer,
    approver: AUDIT_SYNTHETIC_VALUES.approver,
    otherApprover: AUDIT_SYNTHETIC_VALUES.otherApprover,
    auditBusinessDate: AUDIT_SYNTHETIC_VALUES.date,
    fromDate: '2026-02-01',
    toDate: '2026-02-28',
    reason: AUDIT_SYNTHETIC_VALUES.reason,
    evidence: AUDIT_SYNTHETIC_VALUES.evidence,
    requestId: '',
    decision: ''
  };

  try {
    const applicationBuild = await runAdapterCommand({
      id: 'application-build',
      command: benchmarkAdapter.build,
      cwd: benchmarkWorkingDirectory,
      candidateRoot,
      substitutions: baseSubstitutions,
      dotnetPath: options.dotnetPath,
      timeoutMs: TIMEOUTS_MS.build
    });
    evidence.commands.push(applicationBuild);
    setGate(evidence, 'build', applicationBuild.passed, applicationBuild.passed ? 'benchmark-adapter build command completed with an allowed exit code' : 'benchmark-adapter build command failed or timed out');

    const applicationTest = await runAdapterCommand({
      id: 'application-test',
      command: benchmarkAdapter.test,
      cwd: benchmarkWorkingDirectory,
      candidateRoot,
      substitutions: baseSubstitutions,
      dotnetPath: options.dotnetPath,
      timeoutMs: TIMEOUTS_MS.test
    });
    evidence.commands.push(applicationTest);

    const applicationRun = await runAdapterCommand({
      id: 'application-run-canonical-fixture',
      command: benchmarkAdapter.run,
      cwd: benchmarkWorkingDirectory,
      candidateRoot,
      substitutions: baseSubstitutions,
      dotnetPath: options.dotnetPath,
      timeoutMs: TIMEOUTS_MS.run
    });
    evidence.commands.push(applicationRun);
    const applicationOutputs = await collectOutputs(
      outputDirectory,
      benchmarkAdapter.outputs,
      boundOutputDirectory
    );
    const applicationChecks = evaluateModernizationOutputs(applicationOutputs, applicationOutputs, applicationRun, applicationRun);
    if (!applicationTest.passed) {
      applicationChecks.failed.push('application test command failed or timed out');
    }

    const commands = [
      ['initialize', adapter.initialize, {}],
      ['propose-main', adapter.propose, { requestId: 'REQ-A', reason: AUDIT_SYNTHETIC_VALUES.reason, evidence: AUDIT_SYNTHETIC_VALUES.evidence }],
      ['self-approve', adapter.decide, { requestId: 'REQ-A', decision: 'approve', approver: AUDIT_SYNTHETIC_VALUES.proposer }],
      ['checker-approve', adapter.decide, { requestId: 'REQ-A', decision: 'approve', approver: AUDIT_SYNTHETIC_VALUES.approver }],
      ['checker-approve-idempotent', adapter.decide, { requestId: 'REQ-A', decision: 'approve', approver: AUDIT_SYNTHETIC_VALUES.approver }],
      ['propose-reject', adapter.propose, { requestId: 'REQ-B', reason: AUDIT_SYNTHETIC_VALUES.reason, evidence: AUDIT_SYNTHETIC_VALUES.evidence }],
      ['checker-reject', adapter.decide, { requestId: 'REQ-B', decision: 'reject', approver: AUDIT_SYNTHETIC_VALUES.otherApprover }],
      ['propose-missing-reason', adapter.propose, { requestId: 'REQ-MISSING', reason: '', evidence: '' }],
      ['propose-conflict', adapter.propose, { requestId: 'REQ-C', reason: AUDIT_SYNTHETIC_VALUES.reason, evidence: AUDIT_SYNTHETIC_VALUES.evidence }]
    ];

    const results = [];
    for (const [id, command, overrides] of commands) {
      const result = await runAdapterCommand({
        id,
        command,
        cwd: workingDirectory,
        candidateRoot,
        substitutions: { ...baseSubstitutions, ...overrides },
        dotnetPath: options.dotnetPath,
        timeoutMs: TIMEOUTS_MS.auditCommand
      });
      evidence.commands.push(result);
      results.push(result);
    }

    const [approveConflict, rejectConflict] = await Promise.all([
      runAdapterCommand({
        id: 'conflict-approve',
        command: adapter.decide,
        cwd: workingDirectory,
        candidateRoot,
        substitutions: { ...baseSubstitutions, requestId: 'REQ-C', decision: 'approve', approver: AUDIT_SYNTHETIC_VALUES.approver },
        dotnetPath: options.dotnetPath,
        timeoutMs: TIMEOUTS_MS.auditCommand
      }),
      runAdapterCommand({
        id: 'conflict-reject',
        command: adapter.decide,
        cwd: workingDirectory,
        candidateRoot,
        substitutions: { ...baseSubstitutions, requestId: 'REQ-C', decision: 'reject', approver: AUDIT_SYNTHETIC_VALUES.otherApprover },
        dotnetPath: options.dotnetPath,
        timeoutMs: TIMEOUTS_MS.auditCommand
      })
    ]);
    evidence.commands.push(approveConflict, rejectConflict);

    const exportResult = await runAdapterCommand({
      id: 'export-date-range',
      command: adapter.export,
      cwd: workingDirectory,
      candidateRoot,
      substitutions: baseSubstitutions,
      dotnetPath: options.dotnetPath,
      timeoutMs: TIMEOUTS_MS.auditCommand
    });
    evidence.commands.push(exportResult);

    let exported = null;
    try {
      exported = tryParseJson(await fs.readFile(exportPath, 'utf8'));
    } catch {
      exported = tryParseJson(exportResult.stdout);
    }

    const checks = evaluateAuditResults(evidence.commands, exported);
    checks.essential.unshift(...applicationChecks.failed);
    checks.all = [...checks.essential, ...checks.makerChecker, ...checks.integrity];
    setGate(evidence, 'essential-business-invariants', checks.essential.length === 0, checks.essential.join('; ') || 'audit workflow command contract passed');
    setGate(evidence, 'maker-checker-separation', checks.makerChecker.length === 0, checks.makerChecker.join('; ') || 'self-approval was prevented and different checker decisions were accepted');
    setGate(evidence, 'audit-integrity', checks.integrity.length === 0, checks.integrity.join('; ') || 'history was append-only, exportable, and sentinel-safe');

    if (applicationBuild.passed && checks.all.length === 0 && evidence.staticChecks.blockingFindings === 0) {
      passDimension(evidence, 'functionalCorrectness', 'Synthetic audit workflow passed hidden command checks.');
      passDimension(evidence, 'behaviorPreservation', 'Audit feature preserved core reconciliation exception resolution invariants.');
      passDimension(evidence, 'securityControls', 'No blocking pinned static/dependency findings and no sentinel values were exposed in command output/export.');
      passDimension(evidence, 'maintainability', 'Candidate exposed a schema-valid audit adapter with explicit lifecycle commands.');
      passDimension(evidence, 'operability', 'Application build/test/run and audit state-directory lifecycle completed deterministically.');
      passDimension(evidence, 'scopeTraceability', 'Maker-checker and audit-integrity gates map to the audit-feature prompt.');
    } else {
      failDimension(evidence, 'functionalCorrectness', checks.all.join('; ') || (applicationBuild.passed ? 'critical static findings detected' : 'application build failed'));
      failDimension(evidence, 'behaviorPreservation', 'required audit behavior was not fully preserved');
      failDimension(evidence, 'securityControls', 'sentinel exposure or critical static findings were detected');
      failDimension(evidence, 'maintainability', 'audit adapter did not provide a complete lifecycle contract');
      failDimension(evidence, 'operability', 'audit commands did not complete deterministically');
      failDimension(evidence, 'scopeTraceability', 'audit prompt gates were not fully evidenced');
    }
  } catch (error) {
    evidence.dimensions.functionalCorrectness.findings.push(error.message);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }

  return finalizeEvidence(evidence);
}

function evaluateAuditResults(commands, exported) {
  const essential = [];
  const makerChecker = [];
  const integrity = [];
  const allOutput = commands.map((command) => `${command.stdout}\n${command.stderr}`).join('\n');
  const exportedText = JSON.stringify(exported ?? {});
  const entries = exportEntries(exported);

  require(essential, command(commands, 'initialize')?.passed, 'initialize failed');
  require(essential, command(commands, 'propose-main')?.passed, 'valid proposal failed');
  require(makerChecker, proposerFor(entries, 'REQ-A') === AUDIT_SYNTHETIC_VALUES.proposer, 'export did not prove the proposer identity for REQ-A');
  requireSingleFinalDecision(makerChecker, entries, 'REQ-A', 'approved', AUDIT_SYNTHETIC_VALUES.approver, AUDIT_SYNTHETIC_VALUES.proposer);
  requireSingleFinalDecision(makerChecker, entries, 'REQ-B', 'rejected', AUDIT_SYNTHETIC_VALUES.otherApprover, AUDIT_SYNTHETIC_VALUES.proposer);
  require(
    essential,
    commandExplicitlyRejected(command(commands, 'propose-missing-reason')) &&
      !exportHasHistory(exported, 'REQ-MISSING'),
    'missing reason/evidence proposal was not explicitly rejected without durable history'
  );
  require(essential, command(commands, 'checker-approve-idempotent')?.passed, 'duplicate decision was not idempotently handled');
  require(integrity, conflictCommandsCompleted(command(commands, 'conflict-approve'), command(commands, 'conflict-reject')), 'concurrent conflict commands did not complete through declared adapter outcomes');
  require(integrity, finalDecisions(entries, 'REQ-C').length === 1, 'export did not prove exactly one durable final decision for REQ-C concurrent conflict');
  require(integrity, finalDecisions(entries, 'REQ-C').every((decision) => decision.actor), 'export contained a final decision for REQ-C without a recognized actor identity');
  require(integrity, command(commands, 'export-date-range')?.passed, 'date-range export command failed');
  require(integrity, Array.isArray(exported) || (exported && Array.isArray(exported.entries)), 'date-range export did not produce JSON history');
  require(integrity, exportHasHistory(exported, 'REQ-A') && exportHasHistory(exported, 'REQ-B'), 'export missing approved/rejected request history');
  require(integrity, !commands.some((entry) => entry.sensitiveOutputDetected === true) && !`${allOutput}\n${exportedText}`.includes(AUDIT_SYNTHETIC_VALUES.accountSentinel) && !`${allOutput}\n${exportedText}`.includes(AUDIT_SYNTHETIC_VALUES.amountSentinel), 'logs, command output, or export exposed synthetic sentinel account/amount');
  require(integrity, exportLooksAppendOnly(exported), 'export lacks append-only or tamper-evident history metadata');

  return {
    essential,
    makerChecker,
    integrity,
    all: [...essential, ...makerChecker, ...integrity]
  };
}

function command(commands, id) {
  return commands.find((entry) => entry.id === id);
}

function commandExplicitlyRejected(result) {
  if (!result || result.exitCode === null || result.timedOut || result.signal) {
    return false;
  }
  if (result.exitCode !== 0) {
    return true;
  }
  const parsed = tryParseJson(result.stdout);
  const status = typeof parsed?.status === 'string' ? parsed.status.toLowerCase() : '';
  return ['invalid', 'rejected', 'forbidden', 'error', 'failed'].includes(status);
}

function conflictCommandsCompleted(left, right) {
  return [left, right].every((result) => result?.passed && result.exitCode !== null && !result.signal && !result.timedOut);
}

function exportEntries(exported) {
  if (Array.isArray(exported)) {
    return exported;
  }
  if (exported && Array.isArray(exported.entries)) {
    return exported.entries;
  }
  return [];
}

function exportHasHistory(exported, requestId) {
  return exportEntries(exported).some((entry) => JSON.stringify(entry).includes(requestId));
}

function proposerFor(entries, requestId) {
  const proposal = entries.find((entry) => requestIdFor(entry) === requestId && actionFor(entry).startsWith('propos'));
  return actorFor(proposal, ['proposer', 'maker', 'createdBy', 'actor', 'user', 'userId', 'principal']);
}

function finalDecisions(entries, requestId) {
  return entries
    .filter((entry) => requestIdFor(entry) === requestId)
    .map((entry) => ({
      action: finalActionFor(entry),
      actor: actorFor(entry, ['approver', 'approvedBy', 'rejectedBy', 'checker', 'decider', 'decisionBy', 'actor', 'user', 'userId', 'principal'])
    }))
    .filter((decision) => decision.action);
}

function requireSingleFinalDecision(collection, entries, requestId, action, expectedActor, prohibitedActor) {
  const decisions = finalDecisions(entries, requestId);
  require(collection, decisions.length === 1, `export did not prove exactly one durable final decision for ${requestId}`);
  if (decisions.length !== 1) {
    return;
  }

  const [decision] = decisions;
  require(collection, Boolean(decision.actor), `export contained a final decision for ${requestId} without a recognized actor identity`);
  require(collection, decision.action === action, `export final decision for ${requestId} was ${decision.action || 'unrecognized'} instead of ${action}`);
  require(collection, decision.actor === expectedActor, `export final actor for ${requestId} was not the expected checker`);
  require(collection, decision.actor !== prohibitedActor, `export showed proposer as durable approver for ${requestId}`);
}

function requestIdFor(entry) {
  return stringField(entry, ['requestId', 'request_id', 'id', 'resolutionId', 'resolution_id', 'exceptionId', 'exception_id']);
}

function actionFor(entry) {
  return stringField(entry, ['action', 'event', 'eventType', 'type', 'status', 'decision']).toLowerCase();
}

function finalActionFor(entry) {
  const action = actionFor(entry);
  if (/\b(approved|approve)\b/.test(action)) {
    return 'approved';
  }
  if (/\b(rejected|reject)\b/.test(action)) {
    return 'rejected';
  }
  return null;
}

function actorFor(entry, keys) {
  return stringField(entry, keys);
}

function stringField(entry, keys) {
  if (!entry || typeof entry !== 'object') {
    return '';
  }
  for (const key of keys) {
    if (typeof entry[key] === 'string' && entry[key]) {
      return entry[key];
    }
  }
  return '';
}

function exportLooksAppendOnly(exported) {
  const entries = exportEntries(exported);
  if (entries.length === 0) {
    return false;
  }

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry?.sequence !== index + 1) {
      return false;
    }
    const expectedPreviousHash = index === 0 ? null : entries[index - 1].hash;
    if (entry.previousHash !== expectedPreviousHash) {
      return false;
    }
    const unsignedEntry = { ...entry };
    delete unsignedEntry.hash;
    const expectedHash = createHash('sha256')
      .update(canonicalize(unsignedEntry))
      .digest('hex');
    if (entry.hash !== expectedHash) {
      return false;
    }
  }

  for (const requestId of ['REQ-A', 'REQ-B', 'REQ-C']) {
    const history = entries.filter((entry) => requestIdFor(entry) === requestId);
    const proposalIndex = history.findIndex((entry) => actionFor(entry).startsWith('propos'));
    const finalIndex = history.findIndex((entry) => finalActionFor(entry));
    if (proposalIndex < 0 || finalIndex <= proposalIndex) {
      return false;
    }
  }

  return true;
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function require(collection, condition, message) {
  if (!condition) {
    collection.push(message);
  }
}
