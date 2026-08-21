import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { aggregateLane } from "../src/aggregate.js";
import { prepareAuthoringWorkspace } from "../src/authoring.js";
import { loadExperimentConfig, loadScoringConfig, REPO_ROOT } from "../src/config.js";
import { createFreezeReadiness } from "../src/freeze.js";
import {
  validateMeasuredReportSet,
  validateSpecHashesAgainstFreeze
} from "../src/report.js";
import { assignRandomizedOrder, buildPlannedRuns, plannedRunCount } from "../src/runs.js";
import { scoreRun } from "../src/scoring.js";

const config = loadExperimentConfig();

function syntheticRuns() {
  return assignRandomizedOrder(buildPlannedRuns(config)).map((plan) => ({
    ...plan,
    benchmarkVersion: config.benchmarkVersion,
    spec: {
      sha256:
        plan.episodeId === "modernization" ? "a".repeat(64) : "b".repeat(64)
    },
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
      toolCalls: 10
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
    ["mai-spec", "opus-spec"]
  );
  assert.equal(new Set(runs.map((run) => run.runId)).size, 12);
  assert.ok(runs.every((run) => run.inputMode === "spec"));
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
        "evidence/test-runs/2026-08-21-v1.0.0/manifest.json"
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

test("both implementation lanes bind the same approved-spec path per episode", () => {
  for (const episode of config.episodes) {
    const runs = buildPlannedRuns(config).filter((run) => run.episodeId === episode.id);
    assert.deepEqual(new Set(runs.map((run) => run.specBundle)), new Set([episode.specBundle]));
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
        complete.map((run, index) =>
          index === 0
            ? { ...run, spec: { sha256: "c".repeat(64) } }
            : run
        ),
        config
      ),
    /do not share one approved specification hash/
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
          run.episodeId === "modernization"
            ? { ...run, spec: { sha256: "c".repeat(64) } }
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
  const { qualityScore: _qualityScore, hardGatesPassed: _hardGatesPassed, ...timedOut } =
    runs[0];
  runs[0] = {
    ...timedOut,
    status: "timed-out",
    execution: { ...runs[0].execution, status: "timed-out" }
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

test("authoring workspaces contain baseline, prompt, and templates but no sealed evaluator material", () => {
  const outputRoot = mkdtempSync(path.join(tmpdir(), "spec-handoff-authoring-"));
  try {
    const result = prepareAuthoringWorkspace("modernization", outputRoot);
    assert.equal(result.manifest.status, "not-evaluated");
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
    estimatedCostUsd: null,
    repetition
  }));
  const summary = aggregateLane(runs);
  assert.equal(summary.implementationTokenMedian, 160);
  assert.equal(summary.endToEndTokenMedian, 200);
  assert.equal(summary.uncachedInputTokenMedian, 100);
  assert.equal(summary.cachedInputTokenMedian, 20);
  assert.equal(summary.outputTokenMedian, 30);
  assert.equal(summary.reasoningTokenMedian, 10);
});
