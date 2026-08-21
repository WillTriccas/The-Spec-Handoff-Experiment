import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawnCommand } from '../src/commands.js';
import { main } from '../src/cli.js';
import { evaluateAuditFeature } from '../src/audit.js';
import { collectOutputs, evaluateModernization } from '../src/modernization.js';
import { validateModernizationAdapter } from '../src/schema.js';
import { parseDependencyFindings, parseDotnetVulnerabilityFindings, parseNpmAuditFindings, runStaticChecks } from '../src/static-checks.js';

test('modernization evaluator passes a schema-valid candidate that preserves hidden invariants', async () => {
  const candidate = await makeCandidate('modernization-pass');
  await fs.writeFile(path.join(candidate, 'benchmark-adapter.json'), JSON.stringify({
    schemaVersion: '1.0.0',
    workingDirectory: '.',
    build: command(process.execPath, ['-e', '']),
    test: command(process.execPath, ['-e', '']),
    run: command(process.execPath, ['modernization-runner.mjs', '{businessDate}', '{inputDirectory}', '{outputDirectory}']),
    outputs: ['matched-trades.csv', 'break-queue.csv', 'end-of-day-report.txt']
  }, null, 2));
  await fs.writeFile(path.join(candidate, 'modernization-runner.mjs'), `
    import fs from 'node:fs';
    import path from 'node:path';
    const out = process.argv[4];
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'matched-trades.csv'), [
      'trade_id,status,account,instrument,quantity,settlement_date,currency,position_id,settlement_id,override_note',
      'T-NORM,Matched,ACC-MIXED,GILT-1,100,2026-02-19,GBP,P-NORM,S-NORM,',
      'T-TOL-IN,Matched,ACC-TOL,MSFT.OQ,50,2026-02-19,USD,P-TOL-IN,S-TOL-IN,',
      'T-OVR,ManualOverrideSuppressed,ACC-OVR,VOD.L,90,2026-02-19,GBP,P-OVR,S-OVR,synthetic approved suppression',
      'T-OVR-DUP,ManualOverrideMatched,ACC-OVR,RIO.L,80,2026-02-19,GBP,P-OVR-DUP,S-OVR-DUP,synthetic first approval',
      ''
    ].join('\\n'));
    fs.writeFileSync(path.join(out, 'break-queue.csv'), [
      'trade_id,account,instrument,quantity,settlement_date,currency,reasons,position_id,settlement_id',
      'T-DUP,ACC-DUP,IBM.N,10,2026-02-19,USD,DuplicateTradeId,,',
      'T-TOL-OUT,ACC-TOL,TSLA.OQ,12,2026-02-19,USD,SettlementAmountOutOfTolerance,P-TOL-OUT,S-TOL-OUT',
      'T-MISSING-SET,ACC-MISS,ORCL.N,7,2026-02-19,USD,MissingSettlement,P-MISSING-SET,',
      'T-MISSING-POS,ACC-NOPOS,SAP.DE,8,2026-02-19,EUR,MissingPosition,,S-MISSING-POS',
      'T-NONPOS,ACC-BAD,NVDA.OQ,0,2026-02-19,USD,TradeValueOutOfBounds,,',
      ''
    ].join('\\n'));
    fs.writeFileSync(path.join(out, 'end-of-day-report.txt'), [
      'Legacy Trade Reconciliation - End Of Day Report',
      'Stale Overrides',
      'T-OVR-DUP: SuppressBreak (ops-backup)',
      ''
    ].join('\\n'));
  `);

  const evidence = await evaluateModernization(candidate, {});
  assert.equal(evidence.outcome, 'passed', JSON.stringify(evidence.gates, null, 2));
  assert.equal(evidence.gates['essential-business-invariants'].passed, true);
  assert.equal(evidence.commands.length, 4);
});

test('modernization evaluator returns deterministic failed evidence for a missing adapter', async () => {
  const candidate = await makeCandidate('modernization-missing');
  const evidence = await evaluateModernization(candidate, {});
  assert.equal(evidence.outcome, 'failed');
  assert.match(evidence.adapterValidation.errors[0], /benchmark-adapter\.json/);
});

test('modernization evaluator fails the essential gate when the candidate test command fails', async () => {
  const candidate = await makeCandidate('modernization-test-fails');
  await fs.writeFile(path.join(candidate, 'benchmark-adapter.json'), JSON.stringify({
    schemaVersion: '1.0.0',
    workingDirectory: '.',
    build: command(process.execPath, ['-e', '']),
    test: command(process.execPath, ['-e', 'process.exit(9)']),
    run: command(process.execPath, ['modernization-runner.mjs', '{businessDate}', '{inputDirectory}', '{outputDirectory}']),
    outputs: ['matched-trades.csv', 'break-queue.csv', 'end-of-day-report.txt']
  }, null, 2));
  await writeModernizationPassingRunner(candidate);

  const evidence = await evaluateModernization(candidate, {});
  assert.equal(evidence.outcome, 'failed');
  assert.equal(evidence.gates['essential-business-invariants'].passed, false);
  assert.match(evidence.gates['essential-business-invariants'].findings.join('\n'), /test command failed/);
});

test('schema validation rejects additional properties and duplicate exit codes', () => {
  const errors = validateModernizationAdapter({
    schemaVersion: '1.0.0',
    workingDirectory: '.',
    build: command(process.execPath, ['-e', ''], [0, 0]),
    test: command(process.execPath, ['-e', '']),
    run: command(process.execPath, ['-e', '']),
    outputs: ['x'],
    surprise: true
  });
  assert(errors.some((error) => error.includes('surprise')));
  assert(errors.some((error) => error.includes('duplicate')));
});

test('safe path validation fails an escaping working directory', async () => {
  const candidate = await makeCandidate('path-escape');
  await fs.writeFile(path.join(candidate, 'benchmark-adapter.json'), JSON.stringify({
    schemaVersion: '1.0.0',
    workingDirectory: '..',
    build: command(process.execPath, ['-e', '']),
    test: command(process.execPath, ['-e', '']),
    run: command(process.execPath, ['-e', '']),
    outputs: ['x']
  }, null, 2));
  const evidence = await evaluateModernization(candidate, {});
  assert.equal(evidence.outcome, 'failed');
  assert(evidence.adapterValidation.errors.some((error) => error.includes('escapes')));
});

test('declared modernization outputs cannot escape the evaluator output directory', async () => {
  const outputDirectory = await makeCandidate('output-containment');
  await assert.rejects(
    () => collectOutputs(outputDirectory, ['..\\outside.txt']),
    /escapes the candidate directory/
  );
});

test('declared outputs reject replacement of the evaluator-owned output directory', async () => {
  const root = await makeCandidate('output-directory-replacement');
  const outputDirectory = path.join(root, 'output');
  const externalDirectory = path.join(root, 'external');
  await fs.mkdir(outputDirectory);
  await fs.mkdir(externalDirectory);
  await fs.writeFile(path.join(externalDirectory, 'result.txt'), 'external');
  const boundOutputDirectory = await fs.realpath(outputDirectory);
  await fs.rm(outputDirectory, { recursive: true });
  await fs.symlink(
    externalDirectory,
    outputDirectory,
    process.platform === 'win32' ? 'junction' : 'dir'
  );

  await assert.rejects(
    () => collectOutputs(outputDirectory, ['result.txt'], boundOutputDirectory),
    /replaced with a link|escaped its evaluator-owned location/
  );
});

test('audit evaluator passes maker-checker, idempotency, conflict, export, and sentinel checks', async () => {
  const candidate = await makeCandidate('audit-pass');
  await writeBenchmarkAdapter(candidate);
  await fs.writeFile(path.join(candidate, 'audit-adapter.json'), JSON.stringify({
    schemaVersion: '1.0.0',
    workingDirectory: '.',
    initialize: command(process.execPath, ['audit-runner.mjs', 'initialize', '{stateDirectory}']),
    propose: command(process.execPath, ['audit-runner.mjs', 'propose', '{stateDirectory}', '{requestId}', '{proposer}', '{businessDate}', '{reason}', '{evidence}', '{accountSentinel}', '{amountSentinel}'], [0, 2]),
    decide: command(process.execPath, ['audit-runner.mjs', 'decide', '{stateDirectory}', '{requestId}', '{approver}', '{decision}', '{reason}', '{evidence}'], [0, 2]),
    export: command(process.execPath, ['audit-runner.mjs', 'export', '{stateDirectory}', '{fromDate}', '{toDate}', '{exportPath}'])
  }, null, 2));
  await fs.writeFile(path.join(candidate, 'audit-runner.mjs'), `
    import fs from 'node:fs';
    import path from 'node:path';
    import { createHash } from 'node:crypto';
    const [mode, stateDir, requestId, actor, arg4, arg5, arg6] = process.argv.slice(2);
    fs.mkdirSync(stateDir, { recursive: true });
    const dbPath = path.join(stateDir, 'history.json');
    const read = () => fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath, 'utf8')) : [];
    const write = entries => fs.writeFileSync(dbPath, JSON.stringify(entries, null, 2));
    const emit = value => console.log(JSON.stringify(value));
    const canonicalize = value => Array.isArray(value)
      ? '[' + value.map(canonicalize).join(',') + ']'
      : value && typeof value === 'object'
        ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalize(value[key])).join(',') + '}'
        : JSON.stringify(value);
    const append = (entries, value) => {
      const entry = { ...value, sequence: entries.length + 1, previousHash: entries.length ? entries.at(-1).hash : null };
      entry.hash = createHash('sha256').update(canonicalize(entry)).digest('hex');
      entries.push(entry);
    };
    if (mode === 'initialize') { write(read()); emit({ status: 'initialized' }); process.exit(0); }
    if (mode === 'propose') {
      const reason = process.argv[6], evidence = process.argv[7];
      if (!reason || !evidence) { emit({ status: 'invalid' }); process.exit(2); }
      const entries = read();
      append(entries, { requestId, action: 'proposed', proposer: actor, date: arg4 });
      write(entries);
      emit({ requestId, status: 'proposed' });
      process.exit(0);
    }
    if (mode === 'decide') {
      const entries = read();
      const proposed = entries.find(entry => entry.requestId === requestId && entry.action === 'proposed');
      if (!proposed) { emit({ requestId, status: 'invalid' }); process.exit(2); }
      if (actor === proposed.proposer) { emit({ requestId, status: 'forbidden' }); process.exit(2); }
      if (requestId === 'REQ-C' && arg4 === 'reject') { emit({ requestId, status: 'conflict' }); process.exit(2); }
      const final = entries.find(entry => entry.requestId === requestId && (entry.action === 'approved' || entry.action === 'rejected'));
      if (!final) {
        append(entries, { requestId, action: arg4 === 'reject' ? 'rejected' : 'approved', actor });
        write(entries);
      }
      emit({ requestId, status: arg4 === 'reject' ? 'rejected' : 'approved' });
      process.exit(0);
    }
    if (mode === 'export') {
      const exportPath = process.argv[6];
      fs.writeFileSync(exportPath, JSON.stringify({ entries: read() }, null, 2));
      emit({ status: 'exported' });
      process.exit(0);
    }
  `);

  const evidence = await evaluateAuditFeature(candidate, {});
  assert.equal(evidence.outcome, 'passed', JSON.stringify(evidence.gates, null, 2));
  assert.equal(evidence.gates['maker-checker-separation'].passed, true);
  assert.equal(evidence.gates['audit-integrity'].passed, true);
});

test('audit evaluator fails when export shows proposer became durable approver despite safe stdout', async () => {
  const candidate = await makeCandidate('audit-self-approval-export');
  await writeAuditAdapter(candidate);
  await writeAuditRunner(candidate, { durableSelfApproval: true });

  const evidence = await evaluateAuditFeature(candidate, {});
  assert.equal(evidence.outcome, 'failed');
  assert.equal(evidence.gates['maker-checker-separation'].passed, false);
  assert.match(evidence.gates['maker-checker-separation'].findings.join('\n'), /proposer as durable approver/);
});

test('audit evaluator fails when a durable final decision uses an unrecognized actor field', async () => {
  const candidate = await makeCandidate('audit-unrecognized-actor-final');
  await writeAuditAdapter(candidate);
  await writeAuditRunner(candidate, { unrecognizedSelfApprovalFinal: true });

  const evidence = await evaluateAuditFeature(candidate, {});
  assert.equal(evidence.outcome, 'failed');
  assert.equal(evidence.gates['maker-checker-separation'].passed, false);
  assert.match(evidence.gates['maker-checker-separation'].findings.join('\n'), /exactly one durable final decision for REQ-A/);
});

test('audit evaluator fails when concurrent conflict leaves two durable final decisions', async () => {
  const candidate = await makeCandidate('audit-two-finals');
  await writeAuditAdapter(candidate);
  await writeAuditRunner(candidate, { allowTwoConflictFinals: true });

  const evidence = await evaluateAuditFeature(candidate, {});
  assert.equal(evidence.outcome, 'failed');
  assert.equal(evidence.gates['audit-integrity'].passed, false);
  assert.match(evidence.gates['audit-integrity'].findings.join('\n'), /exactly one durable final decision/);
});

test('audit evaluator fails when a crashing conflict command is the only conflict signal', async () => {
  const candidate = await makeCandidate('audit-conflict-crash');
  await writeAuditAdapter(candidate, { decideExitCodes: [0] });
  await writeAuditRunner(candidate, { crashConflictLoser: true });

  const evidence = await evaluateAuditFeature(candidate, {});
  assert.equal(evidence.outcome, 'failed');
  assert.equal(evidence.gates['audit-integrity'].passed, false);
  assert.match(evidence.gates['audit-integrity'].findings.join('\n'), /conflict commands did not complete/);
});

test('audit evaluator fails when an invalid proposal is silently ignored', async () => {
  const candidate = await makeCandidate('audit-ignored-invalid-proposal');
  await writeAuditAdapter(candidate);
  await writeAuditRunner(candidate, { ignoreInvalidProposal: true });

  const evidence = await evaluateAuditFeature(candidate, {});
  assert.equal(evidence.outcome, 'failed');
  assert.equal(evidence.gates['essential-business-invariants'].passed, false);
  assert.match(
    evidence.gates['essential-business-invariants'].findings.join('\n'),
    /not explicitly rejected/
  );
});

test('audit evaluator sets build gate from the real benchmark build command', async () => {
  const candidate = await makeCandidate('audit-build-fails');
  await writeAuditAdapter(candidate, { benchmark: { buildArguments: ['-e', 'process.exit(7)'] } });
  await writeAuditRunner(candidate);

  const evidence = await evaluateAuditFeature(candidate, {});
  assert.equal(evidence.outcome, 'failed');
  assert.equal(evidence.gates.build.passed, false);
  assert.equal(evidence.commands.find((entry) => entry.id === 'application-build').passed, false);
});

test('audit evaluator folds benchmark test failures into essential-business-invariants', async () => {
  const candidate = await makeCandidate('audit-test-fails');
  await writeAuditAdapter(candidate, { benchmark: { testArguments: ['-e', 'process.exit(8)'] } });
  await writeAuditRunner(candidate);

  const evidence = await evaluateAuditFeature(candidate, {});
  assert.equal(evidence.outcome, 'failed');
  assert.equal(evidence.gates.build.passed, true);
  assert.equal(evidence.gates['essential-business-invariants'].passed, false);
  assert.match(evidence.gates['essential-business-invariants'].findings.join('\n'), /application test command failed/);
});

test('audit evaluator detects sentinel disclosure before evidence redaction', async () => {
  const candidate = await makeCandidate('audit-sentinel-leak');
  await writeAuditAdapter(candidate);
  await writeAuditRunner(candidate, { leakSentinel: true });
  const evidence = await evaluateAuditFeature(candidate, {});
  assert.equal(evidence.gates['audit-integrity'].passed, false);
  assert.match(evidence.gates['audit-integrity'].findings.join('\n'), /exposed synthetic sentinel/);
  assert.doesNotMatch(JSON.stringify(evidence), /ACCT-SENTINEL-9f6e3a21/);
});

test('audit evaluator requires a successful export command and ordered history', async () => {
  const exportFailure = await makeCandidate('audit-export-failure');
  await writeAuditAdapter(exportFailure);
  await writeAuditRunner(exportFailure, { exportFailure: true });
  const failedExportEvidence = await evaluateAuditFeature(exportFailure, {});
  assert.equal(failedExportEvidence.gates['audit-integrity'].passed, false);
  assert.match(failedExportEvidence.gates['audit-integrity'].findings.join('\n'), /export command failed/);

  const invalidSequence = await makeCandidate('audit-invalid-sequence');
  await writeAuditAdapter(invalidSequence);
  await writeAuditRunner(invalidSequence, { invalidSequence: true });
  const invalidSequenceEvidence = await evaluateAuditFeature(invalidSequence, {});
  assert.equal(invalidSequenceEvidence.gates['audit-integrity'].passed, false);
  assert.match(invalidSequenceEvidence.gates['audit-integrity'].findings.join('\n'), /append-only/);
});

test('dependency vulnerability parsers promote high and critical findings', () => {
  const npmFindings = parseNpmAuditFindings(JSON.stringify({
    vulnerabilities: {
      lodash: { severity: 'high', via: [{ title: 'Prototype Pollution' }] },
      debug: { severity: 'moderate', via: [] }
    }
  }));
  const dotnetFindings = parseDotnetVulnerabilityFindings(`
    Project 'Example' has the following vulnerable packages
       [net8.0]:
       Top-level Package      Requested   Resolved   Severity   Advisory URL
       > Newtonsoft.Json      12.0.1      12.0.1     Critical   https://example.test/CVE
  `);

  assert.equal(npmFindings.length, 1);
  assert.equal(npmFindings[0].severity, 'high');
  assert.equal(dotnetFindings.length, 1);
  assert.equal(dotnetFindings[0].severity, 'critical');
});

test('dependency scanner failures are blocking findings', () => {
  for (const command of [
    { id: 'npm-audit-json', kind: 'npm', exitCode: null, timedOut: false, stdout: '' },
    { id: 'npm-audit-json', kind: 'npm', exitCode: 0, timedOut: true, stdout: '{}' },
    { id: 'npm-audit-json', kind: 'npm', exitCode: 0, timedOut: false, stdout: 'not-json' },
    { id: 'npm-audit-json', kind: 'npm', exitCode: 1, timedOut: false, stdout: '{"error":{"code":"ENOTFOUND"}}' },
    { id: 'npm-audit-json', kind: 'npm', exitCode: 0, timedOut: false, stdout: '{}' },
    { id: 'dotnet-restore-for-audit', kind: 'dotnet-restore', exitCode: 1, timedOut: false, stdout: '' }
  ]) {
    const findings = parseDependencyFindings(command);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, 'critical');
    assert.equal(findings[0].ruleId, 'dependency-audit-failed');
  }
});

test('dependency scanning audits every package lock instead of the first match', async () => {
  const candidate = await makeCandidate('all-package-locks');
  for (const directory of ['a', 'b']) {
    const packageDirectory = path.join(candidate, directory);
    await fs.mkdir(packageDirectory);
    await fs.writeFile(
      path.join(packageDirectory, 'package-lock.json'),
      JSON.stringify({
        name: directory,
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: { '': { name: directory, version: '1.0.0' } }
      })
    );
  }
  const result = await runStaticChecks(candidate);
  assert.equal(
    result.dependencyAuditCommands.filter((entry) => entry.id === 'npm-audit-json').length,
    2
  );
});

test('dependency scanning audits standalone projects even when a solution exists', async () => {
  const candidate = await makeCandidate('all-dotnet-projects');
  await fs.writeFile(path.join(candidate, 'Example.sln'), '');
  await fs.writeFile(path.join(candidate, 'Referenced.csproj'), '<Project />');
  const unreferencedDirectory = path.join(candidate, 'detached');
  await fs.mkdir(unreferencedDirectory);
  await fs.writeFile(path.join(unreferencedDirectory, 'Unreferenced.CSPROJ'), '<Project />');

  const result = await runStaticChecks(candidate, path.join(candidate, 'missing-dotnet'));
  const expectedTargets = ['Example.sln', 'Referenced.csproj', 'detached/Unreferenced.CSPROJ'];
  for (const commandId of ['dotnet-restore-for-audit', 'dotnet-list-package-vulnerable']) {
    assert.deepEqual(
      result.dependencyAuditCommands
        .filter((entry) => entry.id === commandId)
        .map((entry) => entry.target),
      expectedTargets
    );
  }
});

test('sentinel detection scans untruncated output', async () => {
  const sentinel = 'ACCT-SENTINEL-AFTER-CAP';
  const result = await spawnCommand(
    process.execPath,
    ['-e', `process.stdout.write('x'.repeat(25000) + '${sentinel}')`],
    {
      timeoutMs: 5000,
      sensitiveValues: [sentinel],
      scrubbers: [sentinel]
    }
  );
  assert.equal(result.sensitiveOutputDetected, true);
  assert.doesNotMatch(result.stdout, /ACCT-SENTINEL-AFTER-CAP/);
});

test('spawnCommand timeout terminates descendant process tree', async () => {
  const temp = await makeCandidate('timeout-tree');
  const heartbeat = path.join(temp, 'heartbeat.txt');
  const childScript = path.join(temp, 'child.mjs');
  const parentScript = path.join(temp, 'parent.mjs');
  await fs.writeFile(childScript, `
    import fs from 'node:fs';
    const file = process.argv[2];
    const write = () => fs.writeFileSync(file, String(Date.now()));
    write();
    setInterval(write, 50);
  `);
  await fs.writeFile(parentScript, `
    import { spawn } from 'node:child_process';
    const child = spawn(process.execPath, [process.argv[2], process.argv[3]], { stdio: 'ignore' });
    child.unref();
    setInterval(() => {}, 1000);
  `);

  const result = await spawnCommand(process.execPath, [parentScript, childScript, heartbeat], {
    cwd: temp,
    timeoutMs: 600,
    scrubbers: [temp]
  });
  assert.equal(result.timedOut, true);
  const first = await fs.readFile(heartbeat, 'utf8');
  await new Promise((resolve) => setTimeout(resolve, 350));
  const second = await fs.readFile(heartbeat, 'utf8');
  assert.equal(second, first);
});

test('CLI writes evidence and fixture hashes as deterministic JSON', async () => {
  const candidate = await makeCandidate('cli-missing');
  const evidencePath = path.join(candidate, 'out', 'evidence.json');
  const originalStdout = process.stdout.write;
  let stdout = '';
  process.stdout.write = (chunk) => {
    stdout += chunk;
    return true;
  };
  try {
    await main(['evaluate', '--candidate', candidate, '--episode', 'modernization', '--evidence', evidencePath]);
    await main(['fixture-hashes']);
  } finally {
    process.stdout.write = originalStdout;
  }

  const evidence = JSON.parse(await fs.readFile(evidencePath, 'utf8'));
  assert.equal(evidence.outcome, 'failed');
  assert.match(stdout, /fixtureSetHash/);
  assert.match(stdout, /"episodeId": "modernization"/);
});

function command(executable, args, allowedExitCodes = [0]) {
  return {
    executable,
    arguments: args,
    allowedExitCodes
  };
}

async function makeCandidate(name) {
  return await fs.mkdtemp(path.join(os.tmpdir(), `sealed-evaluator-${name}-`));
}

async function writeModernizationPassingRunner(candidate) {
  await fs.writeFile(path.join(candidate, 'modernization-runner.mjs'), `
    import fs from 'node:fs';
    import path from 'node:path';
    const out = process.argv[4];
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'matched-trades.csv'), [
      'trade_id,status,account,instrument,quantity,settlement_date,currency,position_id,settlement_id,override_note',
      'T-NORM,Matched,ACC-MIXED,GILT-1,100,2026-02-19,GBP,P-NORM,S-NORM,',
      'T-TOL-IN,Matched,ACC-TOL,MSFT.OQ,50,2026-02-19,USD,P-TOL-IN,S-TOL-IN,',
      'T-OVR,ManualOverrideSuppressed,ACC-OVR,VOD.L,90,2026-02-19,GBP,P-OVR,S-OVR,synthetic approved suppression',
      'T-OVR-DUP,ManualOverrideMatched,ACC-OVR,RIO.L,80,2026-02-19,GBP,P-OVR-DUP,S-OVR-DUP,synthetic first approval',
      ''
    ].join('\\n'));
    fs.writeFileSync(path.join(out, 'break-queue.csv'), [
      'trade_id,account,instrument,quantity,settlement_date,currency,reasons,position_id,settlement_id',
      'T-DUP,ACC-DUP,IBM.N,10,2026-02-19,USD,DuplicateTradeId,,',
      'T-TOL-OUT,ACC-TOL,TSLA.OQ,12,2026-02-19,USD,SettlementAmountOutOfTolerance,P-TOL-OUT,S-TOL-OUT',
      'T-MISSING-SET,ACC-MISS,ORCL.N,7,2026-02-19,USD,MissingSettlement,P-MISSING-SET,',
      'T-MISSING-POS,ACC-NOPOS,SAP.DE,8,2026-02-19,EUR,MissingPosition,,S-MISSING-POS',
      'T-NONPOS,ACC-BAD,NVDA.OQ,0,2026-02-19,USD,TradeValueOutOfBounds,,',
      ''
    ].join('\\n'));
    fs.writeFileSync(path.join(out, 'end-of-day-report.txt'), 'Legacy Trade Reconciliation - End Of Day Report\\nStale Overrides\\nT-OVR-DUP: SuppressBreak (ops-backup)\\n');
  `);
}

async function writeAuditAdapter(candidate, options = {}) {
  await writeBenchmarkAdapter(candidate, options.benchmark ?? {});
  await fs.writeFile(path.join(candidate, 'audit-adapter.json'), JSON.stringify({
    schemaVersion: '1.0.0',
    workingDirectory: '.',
    initialize: command(process.execPath, ['audit-runner.mjs', 'initialize', '{stateDirectory}']),
    propose: command(process.execPath, ['audit-runner.mjs', 'propose', '{stateDirectory}', '{requestId}', '{proposer}', '{businessDate}', '{reason}', '{evidence}', '{accountSentinel}', '{amountSentinel}'], [0, 2]),
    decide: command(process.execPath, ['audit-runner.mjs', 'decide', '{stateDirectory}', '{requestId}', '{approver}', '{decision}', '{reason}', '{evidence}'], options.decideExitCodes ?? [0, 2]),
    export: command(process.execPath, ['audit-runner.mjs', 'export', '{stateDirectory}', '{fromDate}', '{toDate}', '{exportPath}'])
  }, null, 2));
}

async function writeBenchmarkAdapter(candidate, options = {}) {
  await writeModernizationPassingRunner(candidate);
  await fs.writeFile(path.join(candidate, 'benchmark-adapter.json'), JSON.stringify({
    schemaVersion: '1.0.0',
    workingDirectory: '.',
    build: command(process.execPath, options.buildArguments ?? ['-e', '']),
    test: command(process.execPath, options.testArguments ?? ['-e', '']),
    run: command(process.execPath, ['modernization-runner.mjs', '{businessDate}', '{inputDirectory}', '{outputDirectory}']),
    outputs: ['matched-trades.csv', 'break-queue.csv', 'end-of-day-report.txt']
  }, null, 2));
}

async function writeAuditRunner(candidate, options = {}) {
  await fs.writeFile(path.join(candidate, 'audit-runner.mjs'), `
    import fs from 'node:fs';
    import path from 'node:path';
    import { createHash } from 'node:crypto';
    const [mode, stateDir, requestId, actor, arg4] = process.argv.slice(2);
    fs.mkdirSync(stateDir, { recursive: true });
    const dbPath = path.join(stateDir, 'history.json');
    const read = () => fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath, 'utf8')) : [];
    const write = entries => fs.writeFileSync(dbPath, JSON.stringify(entries, null, 2));
    const emit = value => console.log(JSON.stringify(value));
    const options = ${JSON.stringify(options)};
    const canonicalize = value => Array.isArray(value)
      ? '[' + value.map(canonicalize).join(',') + ']'
      : value && typeof value === 'object'
        ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalize(value[key])).join(',') + '}'
        : JSON.stringify(value);
    const append = (entries, value) => {
      const entry = { ...value, sequence: entries.length + 1, previousHash: entries.length ? entries.at(-1).hash : null };
      entry.hash = createHash('sha256').update(canonicalize(entry)).digest('hex');
      entries.push(entry);
    };
    if (mode === 'initialize') { write(read()); emit({ status: 'initialized' }); process.exit(0); }
    if (mode === 'propose') {
      const reason = process.argv[6], evidence = process.argv[7];
      if (!reason || !evidence) {
        emit({ status: options.ignoreInvalidProposal ? 'ok' : 'invalid' });
        process.exit(options.ignoreInvalidProposal ? 0 : 2);
      }
      if (options.leakSentinel) { console.log(process.argv[9]); }
      const entries = read();
      append(entries, { requestId, action: 'proposed', proposer: actor, date: arg4 });
      write(entries);
      emit({ requestId, status: 'proposed' });
      process.exit(0);
    }
    if (mode === 'decide') {
      const entries = read();
      const proposed = entries.find(entry => entry.requestId === requestId && entry.action === 'proposed');
      if (!proposed) { emit({ requestId, status: 'invalid' }); process.exit(2); }
      if (requestId === 'REQ-A' && actor === proposed.proposer && options.unrecognizedSelfApprovalFinal) {
        fs.writeFileSync(path.join(stateDir, 'extra-unrecognized-self.json'), JSON.stringify({ sequence: 50, previousHash: 'hash-unrecognized', requestId, action: 'approved', who: actor }));
        emit({ requestId, status: 'forbidden' });
        process.exit(2);
      }
      if (actor === proposed.proposer && !options.durableSelfApproval) { emit({ requestId, status: 'forbidden' }); process.exit(2); }
      if (requestId === 'REQ-C' && arg4 === 'reject' && options.crashConflictLoser) { process.exit(1); }
      if (requestId === 'REQ-C' && arg4 === 'reject' && !options.allowTwoConflictFinals) { emit({ requestId, status: 'conflict' }); process.exit(2); }
      if (requestId === 'REQ-C' && options.allowTwoConflictFinals) {
        fs.writeFileSync(path.join(stateDir, 'conflict-' + arg4 + '.json'), JSON.stringify({ sequence: 100 + (arg4 === 'reject' ? 2 : 1), previousHash: 'hash-conflict', requestId, action: arg4 === 'reject' ? 'rejected' : 'approved', actor }));
        emit({ requestId, status: arg4 === 'reject' ? 'rejected' : 'approved' });
        process.exit(0);
      }
      const final = entries.find(entry => entry.requestId === requestId && (entry.action === 'approved' || entry.action === 'rejected'));
      if (!final || options.allowTwoConflictFinals) {
        append(entries, { requestId, action: arg4 === 'reject' ? 'rejected' : 'approved', actor });
        write(entries);
      }
      emit({ requestId, status: actor === proposed.proposer ? 'forbidden' : (arg4 === 'reject' ? 'rejected' : 'approved') });
      process.exit(actor === proposed.proposer && options.durableSelfApproval ? 2 : 0);
    }
    if (mode === 'export') {
      const exportPath = process.argv[6];
      const extras = fs.readdirSync(stateDir)
        .filter(name => (name.startsWith('conflict-') || name.startsWith('extra-')) && name.endsWith('.json'))
        .map(name => JSON.parse(fs.readFileSync(path.join(stateDir, name), 'utf8')));
      const exportedEntries = [...read(), ...extras];
      if (options.invalidSequence) {
        exportedEntries.forEach(entry => { entry.sequence = 1; });
      }
      fs.writeFileSync(exportPath, JSON.stringify({ entries: exportedEntries }, null, 2));
      emit({ status: 'exported' });
      process.exit(options.exportFailure ? 3 : 0);
    }
  `);
}
