import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { aggregateLane } from "../src/aggregate.js";
import { prepareAuthoringWorkspace } from "../src/authoring.js";
import {
  loadExperimentConfig,
  loadReportSchema,
  loadScoringConfig,
  REPO_ROOT
} from "../src/config.js";
import { createFreezeReadiness } from "../src/freeze.js";
import {
  validateMeasuredReportSet,
  validateSpecHashesAgainstFreeze,
  buildReport
} from "../src/report.js";
import { assignRandomizedOrder, buildPlannedRuns, plannedRunCount } from "../src/runs.js";
import { scoreRun } from "../src/scoring.js";
import { computeEpisodeClaim } from "../src/claim.js";
import { validateAgainstSchema } from "../src/schema-lite.js";

const config = loadExperimentConfig();

function syntheticRuns() {
  return assignRandomizedOrder(buildPlannedRuns(config)).map((plan) => ({
    ...plan,
    benchmarkVersion: config.benchmarkVersion,
    spec:
      plan.inputMode === "spec"
        ? {
            sha256:
              plan.episodeId === "modernization"
                ? "a".repeat(64)
                : "b".repeat(64)
          }
        : null,
    model: {
      id: plan.modelId,
      tier: plan.modelTier
    },
    execution: {
      status: "completed",
      order: plan.executionOrder,
      modelId: plan.modelId,
      modelBuildId: plan.modelBuildId,
      elapsedSeconds: 120,
      productiveSeconds: 100,
      queueSeconds: 20,
      toolCalls: 10,
      inputTokens: 100,
      cachedInputTokens: 10,
      outputTokens: 20,
      reasoningTokens: 30
    },
    frozenInputs: {
      promptSha256:
        plan.inputMode === "spec"
          ? (plan.episodeId === "modernization" ? "c" : "d").repeat(64)
          : (plan.episodeId === "modernization" ? "e" : "f").repeat(64)
    },
    status: "completed",
    qualityScore: 80,
    hardGatesPassed: true
  }));
}

test("the active contract plans exactly 12 unique two-lane cells", () => {
  const runs = buildPlannedRuns(config);
  assert.equal(runs.length, 12);
  assert.equal(plannedRunCount(config), 12);
  assert.deepEqual(
    [...new Set(runs.map((run) => run.laneId))].sort(),
    ["mai-spec", "opus-raw"]
  );
  assert.equal(new Set(runs.map((run) => run.runId)).size, 12);
  assert.equal(runs.filter((run) => run.inputMode === "spec").length, 6);
  assert.equal(runs.filter((run) => run.inputMode === "raw").length, 6);
  assert.equal(config.executionPolicy.timeoutSeconds, null);
  assert.equal(config.executionPolicy.toolCallCap, null);
  const ordered = assignRandomizedOrder(runs);
  assert.ok(
    ordered.slice(1).every(
      (run, index) => run.episodeId !== ordered[index].episodeId
    )
  );
  assert.ok(
    ordered.slice(2).every(
      (run, index) =>
        !(run.laneId === ordered[index + 1].laneId &&
          run.laneId === ordered[index].laneId)
    )
  );
});

test("the committed evidence manifest matches the deterministic interleaved plan", () => {
  const manifest = JSON.parse(
    readFileSync(
      path.join(
        REPO_ROOT,
        "evidence/test-runs/2026-08-21-v2.0.0/manifest.json"
      ),
      "utf8"
    )
  );
  const planned = assignRandomizedOrder(buildPlannedRuns(config))
    .sort((left, right) => left.executionOrder - right.executionOrder);
  assert.equal(manifest.status, "not-evaluated");
  assert.deepEqual(
    manifest.plannedCells.map(({ runId, executionOrder }) => ({ runId, executionOrder })),
    planned.map(({ runId, executionOrder }) => ({ runId, executionOrder }))
  );
});

test("only MAI receives the approved Spec Kit handoff", () => {
  for (const episode of config.episodes) {
    const runs = buildPlannedRuns(config).filter((run) => run.episodeId === episode.id);
    assert.ok(
      runs
        .filter((run) => run.laneId === "mai-spec")
        .every((run) => run.specBundle === episode.specBundle)
    );
    assert.ok(
      runs
        .filter((run) => run.laneId === "opus-raw")
        .every((run) => run.inputMode === "raw")
    );
  }
});

test("measured report-set validation rejects incomplete, duplicate, mixed, and spec-mismatched input", () => {
  const complete = syntheticRuns();
  assert.doesNotThrow(() => validateMeasuredReportSet(complete, config));
  assert.throws(
    () => validateMeasuredReportSet(complete.slice(1), config),
    /incomplete benchmark matrix/
  );
  assert.throws(
    () => validateMeasuredReportSet([...complete, complete[0]], config),
    /duplicate run cell/
  );
  assert.throws(
    () =>
      validateMeasuredReportSet(
        complete.map((run, index) =>
          index === 0 ? { ...run, benchmarkVersion: "different-version" } : run
        ),
        config
      ),
    /mixed or unexpected benchmark versions/
  );
  assert.throws(
    () =>
      validateMeasuredReportSet(
        complete.map((run) =>
          run.runId === "modernization-mai-spec-r1"
            ? { ...run, spec: { sha256: "c".repeat(64) } }
            : run
        ),
        config
      ),
    /bind one approved spec/
  );
});

test("measured run specification hashes must match the trusted freeze record", () => {
  const runs = syntheticRuns();
  const freezeRecord = {
    promptsAndSpecs: [
      {
        episodeId: "modernization",
        assembledSpecSha256: "a".repeat(64)
      },
      {
        episodeId: "audit-feature",
        assembledSpecSha256: "b".repeat(64)
      }
    ]
  };
  assert.doesNotThrow(() =>
    validateSpecHashesAgainstFreeze(runs, config, freezeRecord)
  );
  assert.throws(
    () =>
      validateSpecHashesAgainstFreeze(
        runs.map((run) =>
          run.episodeId === "modernization" && run.laneId === "mai-spec"
            ? { ...run, spec: { sha256: "c".repeat(64) } }
            : run
        ),
        config,
        freezeRecord
      ),
    /does not match the freeze record/
  );
  assert.throws(
    () =>
      validateSpecHashesAgainstFreeze(
        runs.map((run) =>
          run.laneId === "opus-raw"
            ? { ...run, spec: { sha256: "a".repeat(64) } }
            : run
        ),
        config,
        freezeRecord
      ),
    /does not match the freeze record/
  );
});

test("non-completed measured cells are retained but must score zero and fail gates", () => {
  const runs = syntheticRuns();
  const { qualityScore: _qualityScore, hardGatesPassed: _hardGatesPassed, ...failed } =
    runs[0];
  runs[0] = {
    ...failed,
    status: "failed",
    execution: { ...runs[0].execution, status: "failed" }
  };
  assert.doesNotThrow(() => validateMeasuredReportSet(runs, config));
});

test("scoring fails applicable hard gates for a failed implementation", () => {
  const result = scoreRun(
    {
      schemaVersion: "sealed-evaluator-evidence/1.0.0",
      attestation: { independentFromSpecAuthors: true },
      checks: [],
      metrics: {}
    },
    {
      scoringConfig: loadScoringConfig(),
      episodeId: "modernization",
      executionStatus: "failed",
      inputMode: "spec"
    }
  );
  assert.equal(result.qualityScore, 0);
  assert.equal(result.hardGatesPassed, false);
});

test("native sealed-evaluator evidence is normalized before benchmark scoring", () => {
  const result = scoreRun(
    {
      schemaVersion: "sealed-evaluator-evidence/1.0.0",
      attestation: {
        independentFromSpecAuthors: true,
        statement: "Independent sealed evaluator."
      },
      dimensions: {
        functionalCorrectness: { weight: 35, score: 35, passed: true },
        behaviorPreservation: { weight: 20, score: 20, passed: true },
        securityControls: { weight: 15, score: 15, passed: true },
        maintainability: { weight: 15, score: 15, passed: true },
        operability: { weight: 10, score: 10, passed: true },
        scopeTraceability: { weight: 5, score: 5, passed: true }
      },
      gates: {
        build: { applicable: true, passed: true },
        "essential-business-invariants": { applicable: true, passed: true },
        "no-critical-security-findings": { applicable: true, passed: true }
      }
    },
    {
      scoringConfig: loadScoringConfig(),
      episodeId: "modernization",
      executionStatus: "completed",
      inputMode: "spec"
    }
  );
  assert.equal(result.qualityScore, 100);
  assert.equal(result.hardGatesPassed, true);
});

test("freeze readiness fails closed without real specs, evidence, and approvals", () => {
  const readiness = createFreezeReadiness({
    generatedAt: "2026-08-21T10:00:00.000Z"
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.status, "not-evaluated");
  assert.ok(readiness.blockers.some((blocker) => blocker.includes("Approved specification manifest")));
  assert.ok(readiness.blockers.some((blocker) => blocker.includes("Independent specifications approval")));
  assert.match(readiness.recordSha256, /^[a-f0-9]{64}$/);
});

test("authoring evidence contract rejects incomplete completed records", () => {
  const schema = JSON.parse(
    readFileSync(
      path.join(
        REPO_ROOT,
        "contracts/specification-authoring-evidence.schema.json"
      ),
      "utf8"
    )
  );
  const result = validateAgainstSchema(schema, {
    schemaVersion: "specification-authoring-evidence/2.0.0",
    status: "completed",
    episodeId: "modernization"
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("session")));
  assert.ok(result.errors.some((error) => error.includes("artifacts")));
  assert.ok(result.errors.some((error) => error.includes("tokens")));
});

test("schema validator compares array and object const values structurally", () => {
  const schema = {
    type: "object",
    required: ["phases"],
    properties: {
      phases: {
        type: "array",
        const: ["constitution", "specify", "plan"]
      }
    }
  };
  assert.equal(
    validateAgainstSchema(schema, {
      phases: ["constitution", "specify", "plan"]
    }).valid,
    true
  );
  assert.equal(
    validateAgainstSchema(schema, {
      phases: ["constitution", "plan", "specify"]
    }).valid,
    false
  );
});

test("authoring workspaces contain baseline, prompt, and templates but no sealed evaluator material", () => {
  const outputRoot = mkdtempSync(path.join(tmpdir(), "spec-handoff-authoring-"));
  try {
    const result = prepareAuthoringWorkspace("modernization", outputRoot);
    assert.equal(result.manifest.status, "not-evaluated");
    assert.equal(result.manifest.methodology.name, "GitHub Spec Kit");
    assert.equal(
      result.manifest.methodology.implementationDeferredTo,
      "mai-code-1.1-flash"
    );
    for (const artifact of [
      "constitution.md",
      "spec.md",
      "plan.md",
      "tasks.md",
      "analysis.md",
      "checklists/requirements.md"
    ]) {
      assert.equal(
        readFileSync(
          path.join(result.workspaceDirectory, "specification", artifact),
          "utf8"
        ).length > 0,
        true
      );
    }
    assert.deepEqual(result.manifest.allowedInputs, [
      "PROMPT.md",
      "baseline/**",
      "specification/**",
      "workspace-manifest.json"
    ]);
    assert.equal(
      result.workspaceDirectory.includes("evaluator"),
      false
    );
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("headline comparison uses quality, productive time, and implementation tokens", () => {
  const makeRuns = (laneId, qualityScore, productiveSeconds, tokens) =>
    [1, 2, 3].map((repetition) => ({
      laneId,
      modelDisplayName:
        laneId === "mai-spec" ? "MAI Code 1.1 Flash" : "Claude Opus 5",
      inputMode: laneId === "mai-spec" ? "spec" : "raw",
      repetition,
      qualityScore,
      hardGatesPassed: true,
      elapsedSeconds: productiveSeconds + 10,
      productiveSeconds,
      inputTokens: tokens,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      specAuthoringAmortizedTokens: laneId === "mai-spec" ? 10 : 0,
      estimatedCostUsd: null
    }));
  const claim = computeEpisodeClaim(
    "modernization",
    makeRuns("mai-spec", 92, 80, 100),
    makeRuns("opus-raw", 90, 120, 150),
    { claimRule: loadScoringConfig().claimRule }
  );
  assert.equal(claim.status, "supported");
  assert.equal(claim.timeVerdict, "better");
  assert.equal(claim.tokenVerdict, "better");
  assert.equal(claim.productiveTimeDeltaSeconds, -40);
  assert.equal(claim.implementationTokenDelta, -50);
});

test("premeasurement report shape remains schema-valid and not-evaluated", () => {
  const scores = {
    functionalCorrectness: 0,
    behaviorPreservation: 0,
    securityControls: 0,
    maintainability: 0,
    operability: 0,
    scopeTraceability: 0
  };
  const runs = syntheticRuns().map((run) => ({
    ...run,
    dataKind: "illustrative",
    status: "completed",
    scores,
    hardGates: [
      {
        id: "build",
        applicable: true,
        status: "passed",
        reason: null
      }
    ],
    evidenceDirectory: `evidence/not-evaluated/${run.runId}`,
    estimatedCostUsd: null
  }));
  const { report } = buildReport({
    runs,
    benchmarkVersion: config.benchmarkVersion,
    repetitionsPerLane: 3,
    dataKind: "illustrative",
    experimentConfig: config,
    generatedAt: "2026-08-21T10:00:00Z"
  });
  const result = validateAgainstSchema(loadReportSchema(), report);
  assert.deepEqual(result.errors, []);
  assert.equal(report.overallClaim.status, "not-evaluated");
  assert.equal(report.metadata.executionPolicy.timeoutSeconds, null);
  assert.equal(report.metadata.executionPolicy.toolCallCap, null);
});

test("gate failure blocks support without erasing measured verdicts", () => {
  const run = (laneId, hardGatesPassed, productiveSeconds, inputTokens) => ({
    laneId,
    modelDisplayName:
      laneId === "mai-spec" ? "MAI Code 1.1 Flash" : "Claude Opus 5",
    inputMode: laneId === "mai-spec" ? "spec" : "raw",
    qualityScore: 90,
    hardGatesPassed,
    elapsedSeconds: productiveSeconds,
    productiveSeconds,
    inputTokens,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    specAuthoringAmortizedTokens: 0,
    estimatedCostUsd: null
  });
  const claim = computeEpisodeClaim(
    "modernization",
    [run("mai-spec", false, 80, 100)],
    [run("opus-raw", true, 120, 200)],
    { claimRule: loadScoringConfig().claimRule }
  );
  assert.equal(claim.status, "not-supported");
  assert.equal(claim.qualityVerdict, "equivalent");
  assert.equal(claim.timeVerdict, "better");
  assert.equal(claim.tokenVerdict, "better");
});

test("token aggregation separates implementation and amortized end-to-end totals", () => {
  const runs = [1, 2, 3].map((repetition) => ({
    laneId: "mai-spec",
    modelDisplayName: "MAI Code 1.1 Flash",
    inputMode: "spec",
    qualityScore: 90,
    hardGatesPassed: true,
    elapsedSeconds: 100,
    productiveSeconds: 80,
    inputTokens: 100,
    cachedInputTokens: 20,
    outputTokens: 30,
    reasoningTokens: 10,
    specAuthoringAmortizedTokens: 40,
    specAuthoringAmortizedSeconds: 20,
    estimatedCostUsd: null,
    repetition
  }));
  const summary = aggregateLane(runs);
  assert.equal(summary.implementationTokenMedian, 160);
  assert.equal(summary.endToEndTokenMedian, 200);
  assert.equal(summary.endToEndProductiveMedianSeconds, 100);
  assert.equal(summary.uncachedInputTokenMedian, 100);
  assert.equal(summary.cachedInputTokenMedian, 20);
  assert.equal(summary.outputTokenMedian, 30);
  assert.equal(summary.reasoningTokenMedian, 10);
});
