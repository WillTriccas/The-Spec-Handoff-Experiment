import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cmdListRuns, cmdPrepare, cmdImport, cmdScore, cmdAggregate, cmdReport, run } from "../src/cli.js";

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "bench-cli-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Silence console noise from the CLI commands under test while still
// letting assertions on captured output run where useful.
function withSilencedConsole(fn) {
  const originalLog = console.log;
  const originalError = console.error;
  const logs = [];
  const errors = [];
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => errors.push(args.join(" "));
  try {
    return { result: fn(), logs, errors };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

test("cmdListRuns lists all 24 planned runs and returns 0", () => {
  const { result, logs } = withSilencedConsole(() => cmdListRuns());
  assert.strictEqual(result, 0);
  assert.match(logs[0], /Planned runs: 24/);
  assert.strictEqual(logs.length, 25); // header + 24 runs
});

test("cmdListRuns --randomized sorts by executionOrder and reports the configured run order policy", () => {
  const { result, logs } = withSilencedConsole(() => cmdListRuns({ randomized: true }));
  assert.strictEqual(result, 0);
  assert.match(logs[1], /Execution order per executionPolicy\.runOrder/);
  const orderLines = logs.slice(2);
  assert.strictEqual(orderLines.length, 24);
  assert.match(orderLines[0], /^#01 /);
  assert.match(orderLines[23], /^#24 /);
});

test("cmdScore requires --evaluator and --episode-id", () => {
  const { result, errors } = withSilencedConsole(() => cmdScore({}));
  assert.strictEqual(result, 1);
  assert.match(errors[0], /Usage: benchmark score/);
});

test("cmdScore scores a well-formed evaluator file and reports hard gate pass/fail via exit code", () => {
  withTempDir((dir) => {
    const evaluatorPath = path.join(dir, "evaluator.json");
    writeFileSync(
      evaluatorPath,
      JSON.stringify({
        attestation: { independentFromSpecAuthors: true, evaluatorNames: ["reviewer-a"], statement: "blind review" },
        scores: {
          functionalCorrectness: 90,
          behaviorPreservation: 85,
          securityControls: 95,
          maintainability: 80,
          operability: 88,
          scopeTraceability: 92
        },
        hardGates: { build: true, "essential-business-invariants": true, "no-critical-security-findings": true }
      }),
      "utf8"
    );
    const { result, logs } = withSilencedConsole(() =>
      cmdScore({ evaluator: evaluatorPath, "episode-id": "modernization" })
    );
    assert.strictEqual(result, 0);
    const parsed = JSON.parse(logs[0]);
    assert.strictEqual(parsed.hardGatesPassed, true);
    assert.ok(parsed.qualityScore > 0);
  });
});

test("cmdScore surfaces the raw-lane scopeTraceability rubric warning and still returns a gate-driven exit code", () => {
  withTempDir((dir) => {
    const evaluatorPath = path.join(dir, "evaluator.json");
    writeFileSync(
      evaluatorPath,
      JSON.stringify({
        attestation: { independentFromSpecAuthors: true, evaluatorNames: ["reviewer-a"], statement: "blind review" },
        scores: {
          functionalCorrectness: 90,
          behaviorPreservation: 85,
          securityControls: 95,
          maintainability: 80,
          operability: 88,
          scopeTraceability: 0
        },
        hardGates: { build: true, "essential-business-invariants": true, "no-critical-security-findings": true }
      }),
      "utf8"
    );
    const { result, errors } = withSilencedConsole(() =>
      cmdScore({ evaluator: evaluatorPath, "episode-id": "modernization", "input-mode": "raw" })
    );
    assert.strictEqual(result, 0);
    assert.ok(errors.some((e) => /scopeTraceability scored 0 for a raw-lane run/.test(e)));
  });
});

test("cmdAggregate requires --runs and aggregates a JSON array of scored runs into lane summaries", () => {
  const missing = withSilencedConsole(() => cmdAggregate({}));
  assert.strictEqual(missing.result, 1);

  withTempDir((dir) => {
    const runsPath = path.join(dir, "runs.json");
    writeFileSync(
      runsPath,
      JSON.stringify([
        { laneId: "efficient-spec", modelDisplayName: "MAI Code 1.1 Flash", inputMode: "spec", qualityScore: 90, hardGatesPassed: true, elapsedSeconds: 100, estimatedCostUsd: null }
      ]),
      "utf8"
    );
    const { result, logs } = withSilencedConsole(() => cmdAggregate({ runs: runsPath }));
    assert.strictEqual(result, 0);
    const summaries = JSON.parse(logs[0]);
    assert.strictEqual(summaries.length, 1);
    assert.strictEqual(summaries[0].laneId, "efficient-spec");
  });
});

function makeScoredRun(overrides = {}) {
  return {
    runId: "modernization-efficient-spec-r1",
    dataKind: "illustrative",
    benchmarkVersion: "unfrozen",
    episodeId: "modernization",
    laneId: "efficient-spec",
    modelId: "mai-code-1.1-flash",
    modelDisplayName: "MAI Code 1.1 Flash",
    inputMode: "spec",
    repetition: 1,
    status: "completed",
    qualityScore: 88,
    hardGatesPassed: true,
    hardGates: [{ id: "build", applicable: true, passed: true }],
    scores: {
      functionalCorrectness: 90,
      behaviorPreservation: 85,
      securityControls: 95,
      maintainability: 80,
      operability: 88,
      scopeTraceability: 92
    },
    elapsedSeconds: 1200,
    productiveDurationSeconds: 1100,
    queueDurationSeconds: 10,
    agentVersion: "agent-1",
    toolCalls: 10,
    inputTokens: 100,
    cachedInputTokens: 0,
    outputTokens: 50,
    reasoningOutputTokens: 0,
    estimatedCostUsd: null,
    specAuthoringCostUsd: null,
    firstGreenBuildSeconds: null,
    firstPassingSuiteSeconds: null,
    reworkCount: 0,
    scopeChurnFiles: 0,
    baselineRef: "refs/tags/benchmark-legacy-v1",
    spec: {
      id: "modernization-approved",
      sha256: "a".repeat(64),
      qualityScore: 100,
      authoringEffort: {
        elapsedSeconds: 120,
        inputTokens: 20,
        outputTokens: 10,
        estimatedCostUsd: null,
        amortizedAcrossRuns: 3
      }
    },
    evidenceDirectory: "evidence/x",
    frozenInputs: {
      freezeRecordSha256: null,
      evaluatorSha256: "b".repeat(64),
      scoringConfigSha256: "c".repeat(64),
      costsConfigSha256: "d".repeat(64),
      benchmarkEngineSha256: "9".repeat(64),
      promptSha256: "e".repeat(64),
      experimentConfigSha256: "f".repeat(64),
      runSchemaSha256: "1".repeat(64),
      reportSchemaSha256: "2".repeat(64)
    },
    ...overrides
  };
}

test("cmdReport requires --runs, --data-kind and --out, and writes both report.json and a sibling claim-detail.json", () => {
  const missing = withSilencedConsole(() => cmdReport({}));
  assert.strictEqual(missing.result, 1);

  withTempDir((dir) => {
    const runsPath = path.join(dir, "runs.json");
    writeFileSync(runsPath, JSON.stringify([makeScoredRun()]), "utf8");
    const outPath = path.join(dir, "report.json");
    const { result, logs } = withSilencedConsole(() =>
      cmdReport({ runs: runsPath, "data-kind": "illustrative", out: outPath })
    );
    assert.strictEqual(result, 0);
    assert.ok(existsSync(outPath));
    const claimDetailPath = path.join(dir, "report.claim-detail.json");
    assert.ok(existsSync(claimDetailPath));

    const report = JSON.parse(readFileSync(outPath, "utf8"));
    assert.strictEqual(report.overallClaim.status, "not-evaluated");

    const claimDetail = JSON.parse(readFileSync(claimDetailPath, "utf8"));
    assert.strictEqual(claimDetail.dataKind, "illustrative");
    assert.match(logs[0], /Wrote report to/);
  });
});

test("cmdPrepare + cmdImport round-trip a real planned run through the CLI, with cost auto-computation skipped (no dated pricing) and the frozen-data check bypassable via --skip-frozen-check", () => {
  withTempDir((baselineDir) => {
    writeFileSync(path.join(baselineDir, "Program.cs"), "// legacy code", "utf8");
    withTempDir((outputRoot) => {
      const prepared = withSilencedConsole(() =>
        cmdPrepare({ run: "modernization-efficient-raw-r1", baseline: baselineDir, out: outputRoot })
      );
      assert.strictEqual(prepared.result, 0);
      const { runDir } = JSON.parse(prepared.logs[0]);
      assert.ok(existsSync(path.join(runDir, "plan.json")));
      assert.ok(existsSync(path.join(runDir, "provenance.json")));

      const executionPath = path.join(outputRoot, "execution.json");
      writeFileSync(
        executionPath,
        JSON.stringify({
          baselineCommit: "abcdef1234",
          execution: {
            status: "completed",
            startedAt: "2024-06-01T10:00:00Z",
            endedAt: "2024-06-01T10:20:00Z",
            elapsedSeconds: 1200,
            agentVersion: "v1",
            toolCalls: 10,
            inputTokens: 100,
            outputTokens: 50,
            estimatedCostUsd: null
          },
          source: { commit: "abc1234", diffPath: "diffs/x.patch" },
          evidence: { directory: "d", transcriptPath: "t", evaluatorPath: "e" }
        }),
        "utf8"
      );

      const imported = withSilencedConsole(() =>
        cmdImport({
          "run-dir": runDir,
          execution: executionPath,
          "benchmark-version": "unfrozen",
          "skip-frozen-check": true
        })
      );
      assert.strictEqual(imported.result, 0);
      const { run: importedRun, provenancePath } = JSON.parse(imported.logs[0]);
      assert.strictEqual(importedRun.runId, "modernization-efficient-raw-r1");
      assert.strictEqual(importedRun.execution.estimatedCostUsd, null);
      assert.ok(existsSync(provenancePath));
    });
  });
});

test("cmdImport enforces the frozen-clean-version check unless --skip-frozen-check is passed or benchmarkVersion is 'unfrozen'", () => {
  withTempDir((baselineDir) => {
    writeFileSync(path.join(baselineDir, "Program.cs"), "// legacy code", "utf8");
    withTempDir((outputRoot) => {
      const prepared = withSilencedConsole(() =>
        cmdPrepare({ run: "modernization-efficient-raw-r1", baseline: baselineDir, out: outputRoot })
      );
      const { runDir } = JSON.parse(prepared.logs[0]);

      const executionPath = path.join(outputRoot, "execution.json");
      writeFileSync(
        executionPath,
        JSON.stringify({
          baselineCommit: "abcdef1234",
          execution: {
            status: "completed",
            startedAt: "2024-06-01T10:00:00Z",
            endedAt: "2024-06-01T10:20:00Z",
            elapsedSeconds: 1200,
            agentVersion: "v1",
            toolCalls: 10,
            inputTokens: 100,
            outputTokens: 50,
            estimatedCostUsd: null
          },
          source: { commit: "abc1234", diffPath: "diffs/x.patch" },
          evidence: { directory: "d", transcriptPath: "t", evaluatorPath: "e" }
        }),
        "utf8"
      );

      // benchmarkVersion "unfrozen" is always a no-op for the frozen check,
      // regardless of the ambient git working tree state.
      assert.doesNotThrow(() => {
        withSilencedConsole(() =>
          cmdImport({ "run-dir": runDir, execution: executionPath, "benchmark-version": "unfrozen" })
        );
      });
    });
  });
});

test("run() dispatches to the correct subcommand and prints usage for an unknown command", () => {
  const { result, logs } = withSilencedConsole(() => run(["list-runs"]));
  assert.strictEqual(result, 0);
  assert.match(logs[0], /Planned runs: 24/);

  const unknown = withSilencedConsole(() => run(["not-a-command"]));
  assert.strictEqual(unknown.result, 1);
  assert.ok(unknown.logs.some((l) => /benchmark <command>/.test(l)));

  const empty = withSilencedConsole(() => run([]));
  assert.strictEqual(empty.result, 0);
});
