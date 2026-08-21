import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { buildReport, writeReport, writeClaimDetail } from "../src/report.js";
import { validateAgainstSchema } from "../src/schema-lite.js";
import { loadReportSchema } from "../src/config.js";
import { assignRandomizedOrder, buildPlannedRuns } from "../src/runs.js";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const scoringConfig = {
  weights: {
    functionalCorrectness: 35,
    behaviorPreservation: 20,
    securityControls: 15,
    maintainability: 15,
    operability: 10,
    scopeTraceability: 5
  },
  allHardGates: ["build", "essential-business-invariants", "maker-checker-separation", "audit-integrity", "no-critical-security-findings"],
  hardGatesByEpisode: {
    modernization: ["build", "essential-business-invariants", "no-critical-security-findings"],
    "audit-feature": ["build", "essential-business-invariants", "no-critical-security-findings", "maker-checker-separation", "audit-integrity"]
  },
  claimRule: {
    comparisonLane: "efficient-spec",
    controlLane: "frontier-raw",
    equivalentWithinPoints: 3,
    betterByMoreThanPoints: 3,
    requireAllHardGates: true,
    requireLowerMedianCostOrElapsedTimeForEfficiency: true
  },
  secondaryClaimRules: [
    { id: "efficient-within-model-spec-effect", comparisonLane: "efficient-spec", controlLane: "efficient-raw", description: "test" }
  ]
};

const measuredExperimentConfig = {
  benchmarkVersion: "frozen-v1",
  evidenceQualification: {
    level: "strict-measured",
    limitation: "Test fixture uses immutable model build identifiers."
  },
  repetitionsPerLane: 3,
  episodes: [
    { id: "modernization", name: "Platform modernization", baselineRef: "refs/tags/benchmark-legacy-v1" },
    { id: "audit-feature", name: "Regulatory audit feature", baselineRef: "refs/tags/benchmark-modernized-v1" }
  ],
  lanes: [
    { id: "efficient-raw", modelTier: "efficient", inputMode: "raw" },
    { id: "efficient-spec", modelTier: "efficient", inputMode: "spec" },
    { id: "frontier-raw", modelTier: "frontier", inputMode: "raw" },
    { id: "frontier-spec", modelTier: "frontier", inputMode: "spec" }
  ],
  models: {
    efficient: {
      id: "mai-code-1.1-flash",
      displayName: "MAI Code 1.1 Flash",
      buildId: "efficient-model-build",
      agentVersion: "agent-v1",
      agentBuildId: "efficient-agent-build",
      effortParams: { reasoningEffort: "low" }
    },
    frontier: {
      id: "claude-opus-5",
      displayName: "Claude Opus 5",
      buildId: "frontier-model-build",
      agentVersion: "agent-v1",
      agentBuildId: "frontier-agent-build",
      effortParams: { reasoningEffort: "high" }
    }
  },
  executionPolicy: {
    timeoutSeconds: 7200,
    toolCallCap: 200
  }
};

function makeMeasuredFreezeRecord() {
  const record = {
    schemaVersion: "freeze-readiness/1.0.0",
    generatedAt: "2025-01-01T00:00:00Z",
    ready: true,
    blockers: [],
    benchmarkVersion: "frozen-v1",
    evidenceQualification: measuredExperimentConfig.evidenceQualification,
    repository: { headCommit: "head", clean: true, dirtyEntries: [] },
    baselines: [
      {
        episodeId: "modernization",
        ref: "refs/tags/benchmark-legacy-v1",
        commit: "legacy-commit",
        sha256: "1".repeat(64)
      },
      {
        episodeId: "audit-feature",
        ref: "refs/tags/benchmark-modernized-v1",
        commit: "modernized-commit",
        sha256: "2".repeat(64)
      }
    ],
    promptsAndSpecs: measuredExperimentConfig.episodes.map((episode) => ({
      episodeId: episode.id,
      rawPromptSha256: "3".repeat(64),
      specPromptSha256: "3".repeat(64),
      specAuthoringEffort: {
        elapsedMinutes: 2,
        inputTokens: 20,
        outputTokens: 10,
        estimatedCostUsd: null
      }
    })),
    frozenInputs: {
      evaluatorSha256: "c".repeat(64),
      scoringConfigSha256: "d".repeat(64),
      costsConfigSha256: "e".repeat(64),
      benchmarkEngineSha256: "4".repeat(64),
      experimentConfigSha256: "f".repeat(64),
      runSchemaSha256: "1".repeat(64),
      reportSchemaSha256: "2".repeat(64),
      scoringConfig,
      costsConfig: { pricingAsOf: null, source: null, rateType: "unavailable" },
      claimRule: scoringConfig.claimRule
    },
    models: [],
    repetitionsPerLane: 3,
    executionPolicy: measuredExperimentConfig.executionPolicy,
    pricing: {
      pricingAsOf: null,
      source: null,
      rateType: "unavailable",
      monetaryClaimsEnabled: false
    },
    approvals: Object.fromEntries(
      ["scenario", "specifications", "evaluator", "claimAdjudication"].map((area) => [
        area,
        {
          approved: true,
          reviewer: `reviewer-${area}`,
          approvedAt: "2025-01-01T00:00:00Z",
          evidenceRef: `reviews/${area}`
        }
      ])
    )
  };
  record.recordSha256 = createHash("sha256").update(JSON.stringify(record)).digest("hex");
  return record;
}

function makeRun(overrides = {}) {
  return {
    runId: "modernization-efficient-spec-r1",
    dataKind: "illustrative",
    benchmarkVersion: "unfrozen",
    episodeId: "modernization",
    laneId: "efficient-spec",
    modelId: "mai-code-1.1-flash",
    modelDisplayName: "MAI Code 1.1 Flash",
    modelBuildId: "model-build-1",
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
    agentBuildId: "agent-build-1",
    reasoningEffort: "medium",
    toolCalls: 10,
    inputTokens: 100,
    cachedInputTokens: 0,
    outputTokens: 50,
    reasoningOutputTokens: 0,
    estimatedCostUsd: null,
    specAuthoringCostUsd: null,
    firstGreenBuildSeconds: 300,
    firstPassingSuiteSeconds: 900,
    reworkCount: 1,
    scopeChurnFiles: 2,
    baselineRef: "refs/tags/benchmark-legacy-v1",
    sourceCommit: "abc1234",
    spec: {
      id: "modernization-approved",
      sha256: "a".repeat(64),
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
    evidenceDirectory: "evidence/x",
    frozenInputs: {
      freezeRecordSha256: "b".repeat(64),
      evaluatorSha256: "c".repeat(64),
      scoringConfigSha256: "d".repeat(64),
      costsConfigSha256: "e".repeat(64),
      benchmarkEngineSha256: "4".repeat(64),
      promptSha256: "3".repeat(64),
      experimentConfigSha256: "f".repeat(64),
      runSchemaSha256: "1".repeat(64),
      reportSchemaSha256: "2".repeat(64)
    },
    ...overrides
  };
}

function makeMeasuredRuns(transform = (run) => run) {
  const executionOrders = new Map(
    assignRandomizedOrder(buildPlannedRuns(measuredExperimentConfig)).map((run) => [
      run.runId,
      run.executionOrder
    ])
  );
  const runs = [];
  for (const episode of measuredExperimentConfig.episodes) {
    for (const lane of measuredExperimentConfig.lanes) {
      const model = measuredExperimentConfig.models[lane.modelTier];
      for (let repetition = 1; repetition <= measuredExperimentConfig.repetitionsPerLane; repetition += 1) {
        const runId = `${episode.id}-${lane.id}-r${repetition}`;
        const baselineCommit = episode.id === "modernization" ? "legacy-commit" : "modernized-commit";
        const run = {
          schemaVersion: "1.1.0",
          runId,
          dataKind: "measured",
          benchmarkVersion: "frozen-v1",
          episodeId: episode.id,
          laneId: lane.id,
          model: {
            id: model.id,
            displayName: model.displayName,
            tier: lane.modelTier,
            buildId: model.buildId
          },
          inputMode: lane.inputMode,
          repetition,
          baseline: {
            ref: episode.baselineRef,
            commit: baselineCommit,
            sha256: (episode.id === "modernization" ? "1" : "2").repeat(64)
          },
          brief: {
            path: `benchmark/prompts/${episode.id}.md`,
            sha256: "8".repeat(64)
          },
          execution: {
            status: "completed",
            order: executionOrders.get(runId),
            startedAt: "2025-01-01T00:00:00Z",
            endedAt: "2025-01-01T00:20:00Z",
            elapsedSeconds: 1200,
            productiveSeconds: 1100,
            queueSeconds: 10,
            modelId: model.id,
            modelBuildId: model.buildId,
            agentVersion: model.agentVersion,
            agentBuildId: model.agentBuildId,
            reasoningEffort: model.effortParams.reasoningEffort,
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
          spec: lane.inputMode === "spec" ? makeRun().spec : null,
          frozenInputs: {
            freezeRecordSha256: "b".repeat(64),
            evaluatorSha256: "c".repeat(64),
            scoringConfigSha256: "d".repeat(64),
            costsConfigSha256: "e".repeat(64),
            benchmarkEngineSha256: "4".repeat(64),
            promptSha256: "3".repeat(64),
            experimentConfigSha256: "f".repeat(64),
            runSchemaSha256: "1".repeat(64),
            reportSchemaSha256: "2".repeat(64)
          },
          source: {
            commit: `${runId}-commit`,
            diffPath: `${runId}.patch`,
            diffSha256: "6".repeat(64),
            bundlePath: `${runId}.bundle`,
            bundleSha256: "9".repeat(64)
          },
          evidence: {
            directory: "evidence",
            transcriptPath: `${runId}.log`,
            transcriptSha256: "7".repeat(64),
            evaluatorPath: `${runId}.json`,
            evaluatorSha256: "5".repeat(64)
          }
        };
        runs.push(transform(run));
      }
    }
  }
  return runs;
}

function buildMeasured(runs, overrides = {}) {
  const freezeRecord = overrides.freezeRecord ?? makeMeasuredFreezeRecord();
  const { freezeRecord: _freezeRecordOverride, ...remainingOverrides } = overrides;
  const evidenceRoot = mkdtempSync(path.join(tmpdir(), "bench-report-evidence-"));
  try {
    const sourceRepository = path.join(evidenceRoot, "source-repository");
    mkdirSync(sourceRepository);
    writeFileSync(path.join(sourceRepository, "source.txt"), "source", "utf8");
    execFileSync("git", ["init", "--quiet"], { cwd: sourceRepository });
    execFileSync("git", ["config", "user.name", "Benchmark Test"], {
      cwd: sourceRepository
    });
    execFileSync("git", ["config", "user.email", "benchmark@test.invalid"], {
      cwd: sourceRepository
    });
    execFileSync("git", ["add", "--all"], { cwd: sourceRepository });
    execFileSync("git", ["commit", "--quiet", "-m", "source"], {
      cwd: sourceRepository
    });
    const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: sourceRepository,
      encoding: "utf8"
    }).trim();
    const sourceBundlePath = path.join(evidenceRoot, "source.bundle");
    execFileSync("git", ["bundle", "create", sourceBundlePath, "HEAD"], {
      cwd: sourceRepository
    });
    const sourceBundleSha256 = createHash("sha256")
      .update(readFileSync(sourceBundlePath))
      .digest("hex");
    const runsWithFreezeHash = runs.map((run) => {
      const {
        _omitEvidence,
        _evaluatorQualityScore,
        _tamperEvaluatorAfterHash,
        _tamperTranscriptAfterHash,
        _tamperDiffAfterHash,
        _tamperSourceCommit,
        ...cleanRun
      } = run;
      const evaluatorPath = path.join(evidenceRoot, `${run.runId}.json`);
      const evaluatorJson = JSON.stringify({
        attestation: {
          independentFromSpecAuthors: true,
          evaluatorNames: ["test-evaluator"],
          statement: "Independent test evaluator"
        },
        scores: Object.fromEntries(
          Object.keys(scoringConfig.weights).map((dimension) => [
            dimension,
            _evaluatorQualityScore ?? 88
          ])
        ),
        hardGates: Object.fromEntries(
          scoringConfig.allHardGates.map((gate) => [gate, true])
        )
      });
      if (!_omitEvidence) {
        writeFileSync(
          evaluatorPath,
          _tamperEvaluatorAfterHash
            ? evaluatorJson.replace("test-evaluator", "tampered-evaluator")
            : evaluatorJson,
          "utf8"
        );
      }
      const transcriptPath = path.join(evidenceRoot, `${run.runId}.log`);
      const diffPath = path.join(evidenceRoot, `${run.runId}.patch`);
      writeFileSync(
        transcriptPath,
        _tamperTranscriptAfterHash ? `tampered:${run.runId}` : `transcript:${run.runId}`,
        "utf8"
      );
      writeFileSync(
        diffPath,
        _tamperDiffAfterHash ? `tampered:${run.runId}` : `diff:${run.runId}`,
        "utf8"
      );
      return {
        ...cleanRun,
        source: {
          ...cleanRun.source,
          commit: _tamperSourceCommit ? "a".repeat(40) : sourceCommit,
          diffPath,
          diffSha256: createHash("sha256").update(`diff:${run.runId}`).digest("hex"),
          bundlePath: sourceBundlePath,
          bundleSha256: sourceBundleSha256
        },
        evidence: _omitEvidence
          ? {}
          : {
              directory: evidenceRoot,
              transcriptPath,
              transcriptSha256: createHash("sha256")
                .update(`transcript:${run.runId}`)
                .digest("hex"),
              evaluatorPath,
              evaluatorSha256: createHash("sha256").update(evaluatorJson).digest("hex")
            },
        frozenInputs: {
          ...run.frozenInputs,
          freezeRecordSha256: freezeRecord.recordSha256
        }
      };
    });
    return buildReport({
      runs: runsWithFreezeHash,
      benchmarkVersion: "frozen-v1",
      repetitionsPerLane: 3,
      dataKind: "measured",
      scoringConfig,
      costsConfig: { pricingAsOf: null, source: null, rateType: "unavailable" },
      experimentConfig: measuredExperimentConfig,
      evaluatorSha256: "c".repeat(64),
      scoringConfigSha256: "d".repeat(64),
      costsConfigSha256: "e".repeat(64),
      benchmarkEngineSha256: "4".repeat(64),
      experimentConfigSha256: "f".repeat(64),
      runSchemaSha256: "1".repeat(64),
      reportSchemaSha256: "2".repeat(64),
      expectedPromptHashes: new Map([
        ["modernization|raw", "3".repeat(64)],
        ["modernization|spec", "3".repeat(64)],
        ["audit-feature|raw", "3".repeat(64)],
        ["audit-feature|spec", "3".repeat(64)]
      ]),
      freezeRecord,
      repoRoot: evidenceRoot,
      ...remainingOverrides
    });
  } finally {
    rmSync(evidenceRoot, { recursive: true, force: true });
  }
}

test("buildReport throws on an empty run list", () => {
  assert.throws(() => buildReport({ runs: [], benchmarkVersion: "1.0.0", repetitionsPerLane: 3, dataKind: "illustrative", scoringConfig }), /empty/);
});

test("buildReport groups runs by episode and produces one entry per episode", () => {
  const runs = [
    makeRun({ episodeId: "modernization" }),
    makeRun({ episodeId: "audit-feature", runId: "audit-feature-efficient-spec-r1" })
  ];
  const { report } = buildReport({ runs, benchmarkVersion: "unfrozen", repetitionsPerLane: 3, dataKind: "illustrative", scoringConfig });
  const ids = report.episodes.map((e) => e.id).sort();
  assert.deepStrictEqual(ids, ["audit-feature", "modernization"]);
});

test("buildReport output validates against contracts/report.schema.json", () => {
  const runs = [
    makeRun(),
    makeRun({ runId: "modernization-frontier-raw-r1", laneId: "frontier-raw", inputMode: "raw", modelId: "claude-opus-5", modelDisplayName: "Claude Opus 5", spec: null })
  ];
  const { report } = buildReport({ runs, benchmarkVersion: "unfrozen", repetitionsPerLane: 3, dataKind: "illustrative", scoringConfig });
  const { valid, errors } = validateAgainstSchema(loadReportSchema(), report);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(valid, true);
});

test("buildReport forces claim.status to not-evaluated for illustrative data even with favorable-looking numbers", () => {
  const runs = [
    makeRun({ qualityScore: 100, elapsedSeconds: 1 }),
    makeRun({ runId: "modernization-frontier-raw-r1", laneId: "frontier-raw", inputMode: "raw", qualityScore: 1, elapsedSeconds: 999999 })
  ];
  const { report } = buildReport({ runs, benchmarkVersion: "unfrozen", repetitionsPerLane: 3, dataKind: "illustrative", scoringConfig });
  assert.strictEqual(report.overallClaim.status, "not-evaluated");
});

test("buildReport keeps pricingAsOf null when no dated pricing is configured", () => {
  const runs = [makeRun()];
  const { report } = buildReport({ runs, benchmarkVersion: "unfrozen", repetitionsPerLane: 3, dataKind: "illustrative", pricingAsOf: null, scoringConfig });
  assert.strictEqual(report.metadata.pricingAsOf, null);
  assert.strictEqual(report.episodes[0].runs[0].estimatedCostUsd, null);
});

test("buildReport preserves explicit illustrative spec-authoring token evidence", () => {
  const runs = [
    makeRun({
      spec: null,
      specAuthoringAmortizedTokens: 19_950
    })
  ];
  const { report } = buildReport({
    runs,
    benchmarkVersion: "unfrozen",
    repetitionsPerLane: 3,
    dataKind: "illustrative",
    scoringConfig
  });
  assert.strictEqual(
    report.episodes[0].runs[0].specAuthoringAmortizedTokens,
    19_950
  );
});

test("buildReport's overall claim contains the schema-required verdict fields", () => {
  const { report } = buildMeasured(makeMeasuredRuns());
  assert.deepStrictEqual(Object.keys(report.overallClaim).sort(), [
    "costSavingPercent",
    "drivingMetric",
    "efficiencyVerdict",
    "message",
    "qualityDelta",
    "qualityVerdict",
    "status"
  ]);
});

test("buildReport returns a separate claimDetail with per-episode claims and secondary claims", () => {
  const { claimDetail } = buildMeasured(makeMeasuredRuns());
  assert.strictEqual(claimDetail.episodeClaims.length, 2);
  assert.strictEqual(claimDetail.episodeClaims[0].episodeId, "modernization");
  assert.strictEqual(claimDetail.secondaryClaims.length, 1);
  assert.strictEqual(claimDetail.secondaryClaims[0].id, "efficient-within-model-spec-effect");
});

test("buildReport rejects an incomplete measured benchmark matrix", () => {
  assert.throws(() => buildMeasured(makeMeasuredRuns().slice(0, -1)), /incomplete benchmark matrix/);
});

test("buildReport rejects republishing illustrative runs as measured", () => {
  assert.throws(
    () => buildReport({ runs: [makeRun()], benchmarkVersion: "frozen-v1", dataKind: "measured", scoringConfig }),
    /does not match run dataKind/
  );
});

test("buildReport rejects measured runs scored under a different configuration hash", () => {
  assert.throws(
    () => buildMeasured(makeMeasuredRuns(), { scoringConfigSha256: "f".repeat(64) }),
    /scoring configuration does not match/
  );
});

test("buildReport rejects an injected scoring configuration object", () => {
  const injectedConfig = {
    ...scoringConfig,
    claimRule: {
      ...scoringConfig.claimRule,
      comparisonLane: "frontier-raw",
      controlLane: "efficient-spec"
    }
  };
  assert.throws(
    () => buildMeasured(makeMeasuredRuns(), { scoringConfig: injectedConfig }),
    /scoring configuration object does not match/
  );
});

test("buildReport rejects mixed model builds in measured evidence", () => {
  const runs = makeMeasuredRuns((run) =>
    run.runId === "modernization-efficient-spec-r1"
      ? { ...run, model: { ...run.model, buildId: "drifted-build" } }
      : run
  );
  assert.throws(() => buildMeasured(runs), /disagree on frozen efficient model build/);
});

test("buildReport rejects baseline commits that drift from the freeze record", () => {
  const runs = makeMeasuredRuns((run) =>
    run.episodeId === "modernization"
      ? { ...run, baseline: { ...run.baseline, commit: "tampered-commit" } }
      : run
  );
  assert.throws(() => buildMeasured(runs), /baseline does not match the freeze record/);
});

test("buildReport rejects executed model, order, timeout, and tool-cap drift", () => {
  const cases = [
    { modelId: "wrong-model" },
    { order: 999 },
    { elapsedSeconds: measuredExperimentConfig.executionPolicy.timeoutSeconds + 1 },
    { toolCalls: measuredExperimentConfig.executionPolicy.toolCallCap + 1 }
  ];
  for (const executionOverride of cases) {
    const runs = makeMeasuredRuns((run) =>
      run.runId === "modernization-efficient-raw-r1"
        ? { ...run, execution: { ...run.execution, ...executionOverride } }
        : run
    );
    assert.throws(
      () => buildMeasured(runs),
      /planned order or executed model pin|exceeded the frozen execution policy/
    );
  }
});

test("buildReport accepts a timed-out run retained at the 120-minute boundary", () => {
  const runs = makeMeasuredRuns((run) =>
    run.runId === "modernization-efficient-raw-r1"
      ? {
          ...run,
          execution: {
            ...run.execution,
            status: "timed-out",
            elapsedSeconds: 7200
          }
        }
      : run
  );
  const { report } = buildMeasured(runs);
  assert.deepStrictEqual(report.metadata.executionPolicy, {
    timeoutSeconds: 7200,
    toolCallCap: 200
  });
  const retained = report.episodes
    .flatMap((episode) => episode.runs)
    .find((run) => run.runId === "modernization-efficient-raw-r1");
  assert.strictEqual(retained.status, "timed-out");
  assert.strictEqual(retained.qualityScore, 0);
});

test("buildReport rejects a changed report contract for measured evidence", () => {
  assert.throws(
    () => buildMeasured(makeMeasuredRuns(), { reportSchemaSha256: "9".repeat(64) }),
    /report contract does not match/
  );
});

test("buildReport rejects measured prompt hashes that do not match canonical prompts", () => {
  const runs = makeMeasuredRuns((run) => ({
    ...run,
    frozenInputs: { ...run.frozenInputs, promptSha256: "9".repeat(64) }
  }));
  assert.throws(() => buildMeasured(runs), /prompt hash does not match/);
});

test("buildReport rejects caller-supplied pricing dates for measured evidence", () => {
  assert.throws(
    () => buildMeasured(makeMeasuredRuns(), { pricingAsOf: "2099-01-01" }),
    /pricingAsOf override/
  );
});

test("buildReport rejects a costs configuration object that differs from the freeze record", () => {
  assert.throws(
    () =>
      buildMeasured(makeMeasuredRuns(), {
        costsConfig: { pricingAsOf: null, rateType: "list" }
      }),
    /costs configuration object does not match/
  );
});

test("buildReport passes the frozen pricing date into claim messaging", () => {
  const freezeRecord = makeMeasuredFreezeRecord();
  const datedCostsConfig = {
    pricingAsOf: "2025-01-01",
    source: null,
    rateType: "unavailable"
  };
  freezeRecord.pricing.pricingAsOf = "2025-01-01";
  freezeRecord.frozenInputs.costsConfig = datedCostsConfig;
  delete freezeRecord.recordSha256;
  freezeRecord.recordSha256 = createHash("sha256")
    .update(JSON.stringify(freezeRecord))
    .digest("hex");
  const runs = makeMeasuredRuns((run) => {
    if (run.laneId === "efficient-spec") {
      return { ...run, execution: { ...run.execution, estimatedCostUsd: 1 } };
    }
    if (run.laneId === "frontier-raw") {
      return { ...run, execution: { ...run.execution, estimatedCostUsd: 5 } };
    }
    return run;
  });
  const { report } = buildMeasured(runs, {
    freezeRecord,
    costsConfig: datedCostsConfig
  });
  assert.strictEqual(report.metadata.pricingAsOf, "2025-01-01");
  assert.match(report.overallClaim.message, /Pricing as of 2025-01-01/);
});

test("buildReport rejects measured runs without explicit evidence paths", () => {
  const runs = makeMeasuredRuns((run) => ({ ...run, _omitEvidence: true }));
  assert.throws(() => buildMeasured(runs), /fails the run contract/);
});

test("buildReport rejects evaluator evidence changed after import", () => {
  const runs = makeMeasuredRuns((run) =>
    run.runId === "modernization-efficient-raw-r1"
      ? { ...run, _tamperEvaluatorAfterHash: true }
      : run
  );
  assert.throws(() => buildMeasured(runs), /evaluator evidence hash mismatch/);
});

test("buildReport rejects transcript or source diff evidence changed after import", () => {
  for (const tamperFlag of ["_tamperTranscriptAfterHash", "_tamperDiffAfterHash"]) {
    const runs = makeMeasuredRuns((run) =>
      run.runId === "modernization-efficient-raw-r1"
        ? { ...run, [tamperFlag]: true }
        : run
    );
    assert.throws(() => buildMeasured(runs), /transcript evidence hash mismatch|source diff hash mismatch/);
  }
});

test("buildReport verifies the claimed source commit against the sealed Git bundle", () => {
  const runs = makeMeasuredRuns((run) =>
    run.runId === "modernization-efficient-raw-r1"
      ? { ...run, _tamperSourceCommit: true }
      : run
  );
  assert.throws(() => buildMeasured(runs), /source bundle does not contain commit/);
});

test("buildReport recomputes measured quality and cost from sealed inputs", () => {
  const runs = makeMeasuredRuns((run) =>
    run.runId === "modernization-efficient-spec-r1"
      ? {
          ...run,
          _evaluatorQualityScore: 42,
          execution: { ...run.execution, estimatedCostUsd: 999 }
        }
      : run
  );
  const { report } = buildMeasured(runs);
  const measuredRun = report.episodes
    .find((episode) => episode.id === "modernization")
    .runs.find((run) => run.runId === "modernization-efficient-spec-r1");
  assert.strictEqual(measuredRun.qualityScore, 42);
  assert.strictEqual(measuredRun.estimatedCostUsd, null);
});

test("buildReport rejects an uncontracted spec-authoring token override", () => {
  const runs = makeMeasuredRuns((run) =>
    run.runId === "modernization-efficient-spec-r1"
      ? { ...run, specAuthoringAmortizedTokens: 0 }
      : run
  );
  assert.throws(() => buildMeasured(runs), /fails the run contract/);
});

test("writeReport writes the report JSON to disk", () => {
  const runs = [makeRun()];
  const { report } = buildReport({ runs, benchmarkVersion: "unfrozen", repetitionsPerLane: 3, dataKind: "illustrative", scoringConfig });
  const dir = mkdtempSync(path.join(tmpdir(), "bench-report-"));
  try {
    const outPath = path.join(dir, "report.json");
    writeReport(report, outPath);
    assert.ok(existsSync(outPath));
    const onDisk = JSON.parse(readFileSync(outPath, "utf8"));
    assert.strictEqual(onDisk.metadata.dataKind, "illustrative");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeClaimDetail writes the claim-detail JSON to disk", () => {
  const runs = [makeRun()];
  const { claimDetail } = buildReport({ runs, benchmarkVersion: "unfrozen", repetitionsPerLane: 3, dataKind: "illustrative", scoringConfig });
  const dir = mkdtempSync(path.join(tmpdir(), "bench-claim-detail-"));
  try {
    const outPath = path.join(dir, "claim-detail.json");
    writeClaimDetail(claimDetail, outPath);
    assert.ok(existsSync(outPath));
    const onDisk = JSON.parse(readFileSync(outPath, "utf8"));
    assert.strictEqual(onDisk.dataKind, "illustrative");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
