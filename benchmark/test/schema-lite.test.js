import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAgainstSchema } from "../src/schema-lite.js";
import { loadRunSchema, loadReportSchema } from "../src/config.js";

const runSchema = loadRunSchema();
const reportSchema = loadReportSchema();

function validRun(overrides = {}) {
  return {
    schemaVersion: "1.1.0",
    dataKind: "illustrative",
    runId: "modernization-efficient-spec-r1",
    benchmarkVersion: "unfrozen",
    episodeId: "modernization",
    laneId: "efficient-spec",
    model: { id: "mai-code-1.1-flash", displayName: "MAI Code 1.1 Flash", tier: "efficient", buildId: null },
    inputMode: "spec",
    repetition: 1,
    baseline: { ref: "refs/tags/benchmark-legacy-v1", commit: "abcdef1234", sha256: "a".repeat(64) },
    brief: { path: "benchmark/prompts/modernization-raw.md", sha256: "b".repeat(64) },
    spec: {
      id: "modernization-approved",
      sha256: "c".repeat(64),
      qualityScore: 100,
      authoringEffort: {
        elapsedSeconds: 120,
        inputTokens: 20,
        outputTokens: 10,
        estimatedCostUsd: null,
        costEvidenceRef: null,
        costMethod: null,
        amortizedAcrossRuns: 3
      }
    },
    frozenInputs: {
      freezeRecordSha256: null,
      evaluatorSha256: "d".repeat(64),
      scoringConfigSha256: "e".repeat(64),
      costsConfigSha256: "f".repeat(64),
      benchmarkEngineSha256: "9".repeat(64),
      promptSha256: "1".repeat(64),
      experimentConfigSha256: "2".repeat(64),
      runSchemaSha256: "3".repeat(64),
      reportSchemaSha256: "4".repeat(64)
    },
    execution: {
      status: "completed",
      order: 1,
      startedAt: "2024-06-01T10:00:00Z",
      endedAt: "2024-06-01T10:20:00Z",
      elapsedSeconds: 1200,
      productiveSeconds: 1100,
      queueSeconds: 10,
      modelId: null,
      modelBuildId: null,
      agentVersion: "v1",
      agentBuildId: null,
      reasoningEffort: null,
      toolCalls: 10,
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 50,
      reasoningTokens: 0,
      estimatedCostUsd: null,
      specAuthoringCostUsd: null,
      firstGreenBuildSeconds: 300,
      firstPassingSuiteSeconds: 900,
      reworkCount: 1,
      scopeChurnFiles: 2
    },
    source: {
      commit: "abc1234",
      diffPath: "diffs/x.patch",
      diffSha256: null,
      bundlePath: "evidence/source.bundle",
      bundleSha256: null
    },
    evidence: {
      directory: "d",
      transcriptPath: "t",
      transcriptSha256: null,
      evaluatorPath: "e",
      evaluatorSha256: null
    },
    ...overrides
  };
}

test("a well-formed run object validates against contracts/run.schema.json", () => {
  const { valid, errors } = validateAgainstSchema(runSchema, validRun());
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(valid, true);
});

test("a run object with spec=null validates (raw lane)", () => {
  const run = validRun({ inputMode: "raw", laneId: "efficient-raw", spec: null });
  const { valid, errors } = validateAgainstSchema(runSchema, run);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(valid, true);
});

test("a run missing a required field fails validation", () => {
  const run = validRun();
  delete run.execution;
  const { valid, errors } = validateAgainstSchema(runSchema, run);
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.includes("execution")));
});

test("a run with an invalid laneId enum value fails validation", () => {
  const run = validRun({ laneId: "not-a-real-lane" });
  const { valid, errors } = validateAgainstSchema(runSchema, run);
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.includes("laneId")));
});

test("a run with a malformed sha256 fails validation", () => {
  const run = validRun();
  run.baseline.sha256 = "not-a-hash";
  const { valid, errors } = validateAgainstSchema(runSchema, run);
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.includes("sha256")));
});

test("a run with additional properties fails validation", () => {
  const run = validRun({ unexpectedField: true });
  const { valid, errors } = validateAgainstSchema(runSchema, run);
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.includes("additional property")));
});

function validReport(overrides = {}) {
  const scores = {
    functionalCorrectness: 90,
    behaviorPreservation: 85,
    securityControls: 95,
    maintainability: 80,
    operability: 88,
    scopeTraceability: 92
  };
  const claim = {
    status: "not-evaluated",
    qualityVerdict: "indeterminate",
    efficiencyVerdict: "unavailable",
    drivingMetric: "unavailable",
    qualityDelta: null,
    costSavingPercent: null,
    message: "Illustrative only."
  };
  const reportRun = {
    runId: "modernization-efficient-spec-r1",
    dataKind: "illustrative",
    laneId: "efficient-spec",
    modelDisplayName: "MAI Code 1.1 Flash",
    inputMode: "spec",
    repetition: 1,
    status: "completed",
    qualityScore: 88,
    hardGatesPassed: true,
    hardGates: [{ id: "build", applicable: true, status: "passed", reason: null }],
    scores,
    elapsedSeconds: 1200,
    productiveSeconds: 1100,
    queueSeconds: 10,
    toolCalls: 10,
    inputTokens: 100,
    cachedInputTokens: 0,
    outputTokens: 50,
    reasoningTokens: 0,
    estimatedCostUsd: null,
    specAuthoringAmortizedCostUsd: null,
    specAuthoringAmortizedTokens: 0,
    evidencePath: "evidence/x"
  };
  return {
    schemaVersion: "1.1.0",
    metadata: {
      benchmarkVersion: "unfrozen",
      generatedAt: "2024-06-01T00:00:00Z",
      dataKind: "illustrative",
      evidenceQualification: {
        level: "illustrative",
        limitation: "Synthetic fixture data."
      },
      repetitionsPerLane: 3,
      executionPolicy: {
        timeoutSeconds: 7200,
        toolCallCap: 200
      },
      pricingAsOf: null,
      rateType: "unavailable",
      frozenInputs: {
        freezeRecordSha256: null,
        evaluatorSha256: "d".repeat(64),
        scoringConfigSha256: "e".repeat(64),
        costsConfigSha256: "f".repeat(64),
        benchmarkEngineSha256: "9".repeat(64),
        promptSha256s: ["1".repeat(64)],
        experimentConfigSha256: "2".repeat(64),
        runSchemaSha256: "3".repeat(64),
        reportSchemaSha256: "4".repeat(64),
        claimRule: {}
      },
      frozenVersions: ["refs/tags/benchmark-legacy-v1", "v1"]
    },
    overallClaim: claim,
    episodes: [
      {
        id: "modernization",
        name: "Platform modernization",
        claim,
        laneSummaries: [
          {
            laneId: "efficient-spec",
            modelDisplayName: "MAI Code 1.1 Flash",
            inputMode: "spec",
            qualityMedian: 88,
            qualityMin: 85,
            qualityMax: 90,
            hardGatePassCount: 3,
            hardGateFailCount: 0,
            runCount: 3,
            elapsedMedianSeconds: 1200,
            productiveMedianSeconds: 1100,
            tokenMedian: 150,
            costMedianUsd: null
          }
        ],
        runs: [reportRun]
      }
    ],
    ...overrides
  };
}

test("a well-formed report validates against contracts/report.schema.json", () => {
  const { valid, errors } = validateAgainstSchema(reportSchema, validReport());
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(valid, true);
});

test("a measured report cannot contain illustrative run rows", () => {
  const report = validReport();
  report.metadata.dataKind = "measured";
  report.metadata.benchmarkVersion = "frozen-v1";
  report.metadata.frozenInputs.freezeRecordSha256 = "a".repeat(64);
  const { valid, errors } = validateAgainstSchema(reportSchema, report);
  assert.strictEqual(valid, false);
  assert.ok(errors.some((error) => error.includes("dataKind")));
});

test("a report with an invalid claim status fails validation", () => {
  const report = validReport();
  report.overallClaim.status = "maybe";
  const { valid, errors } = validateAgainstSchema(reportSchema, report);
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.includes("status")));
});

test("a report with an invalid episode id fails validation", () => {
  const report = validReport();
  report.episodes[0].id = "not-an-episode";
  const { valid, errors } = validateAgainstSchema(reportSchema, report);
  assert.strictEqual(valid, false);
});

test("a report with a score dimension out of range fails validation", () => {
  const report = validReport();
  report.episodes[0].runs[0].scores.functionalCorrectness = 150;
  const { valid, errors } = validateAgainstSchema(reportSchema, report);
  assert.strictEqual(valid, false);
  assert.ok(errors.some((e) => e.includes("maximum")));
});
