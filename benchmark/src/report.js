import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { aggregateEpisode } from "./aggregate.js";
import {
  CONFIG_DIR,
  CONTRACTS_DIR,
  REPO_ROOT,
  getExperimentConfigPath,
  loadCostsConfig,
  loadExperimentConfig,
  loadRunSchema,
  loadReportSchema,
  loadScoringConfig
} from "./config.js";
import { determineClaim } from "./claim.js";
import { amortizedSpecAuthoringShareUsd, computeCostUsd } from "./cost.js";
import {
  assemblePromptText,
  hashDirectory,
  hashFile,
  hashText
} from "./prepare.js";
import { validateAgainstSchema } from "./schema-lite.js";
import {
  hashSpecKitBundle,
  loadSpecKitBundle,
  renderSpecKitBundle,
  validateSpecKitBundle
} from "../../spec-factory/src/spec-kit.js";
import { assertUsableFreezeRecord } from "./freeze.js";
import { scoreRun } from "./scoring.js";
import { assignRandomizedOrder, buildPlannedRuns } from "./runs.js";

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined))];
}

function commonNullable(values, label) {
  const present = unique(values);
  if (present.length > 1) {
    throw new Error(`Cannot build report: runs disagree on frozen ${label}`);
  }
  return present[0] ?? null;
}

function commonRequired(values, label) {
  if (values.some((value) => value === null || value === undefined || value === "")) {
    throw new Error(`Cannot build measured report: missing frozen ${label}`);
  }
  return commonNullable(values, label);
}

export function validateMeasuredReportSet(runs, experimentConfig = loadExperimentConfig()) {
  const versions = unique(runs.map((run) => run.benchmarkVersion));
  if (versions.length !== 1 || versions[0] !== experimentConfig.benchmarkVersion) {
    throw new Error("Cannot build measured report: mixed or unexpected benchmark versions");
  }
  const expected = new Map();
  for (const plan of assignRandomizedOrder(buildPlannedRuns(experimentConfig))) {
    const key = `${plan.episodeId}|${plan.laneId}|${plan.repetition}`;
    expected.set(key, plan);
  }

  const seenKeys = new Set();
  const seenRunIds = new Set();
  for (const run of runs) {
    const key = `${run.episodeId}|${run.laneId}|${run.repetition}`;
    const expectedPlan = expected.get(key);
    if (!expectedPlan) {
      throw new Error(`Cannot build measured report: unexpected run cell ${key}`);
    }
    if (seenKeys.has(key) || seenRunIds.has(run.runId)) {
      throw new Error(`Cannot build measured report: duplicate run cell or runId at ${key}`);
    }
    if (run.runId !== expectedPlan.runId) {
      throw new Error(
        `Cannot build measured report: run ${run.runId} does not match expected id ${expectedPlan.runId}`
      );
    }
    const lane = experimentConfig.lanes.find((entry) => entry.id === run.laneId);
    const configuredModel = experimentConfig.models[lane.modelTier];
    if (
      run.inputMode !== lane.inputMode ||
      (run.model?.id ?? run.modelId) !== configuredModel.id ||
      (run.model?.tier ?? run.modelTier) !== lane.modelTier
    ) {
      throw new Error(`Cannot build measured report: run ${run.runId} does not match its frozen lane/model configuration`);
    }
    const execution = run.execution ?? {};
    if (
      execution.order !== expectedPlan.executionOrder ||
      execution.modelId !== configuredModel.id ||
      execution.modelBuildId !== configuredModel.buildId
    ) {
      throw new Error(
        `Cannot build measured report: run ${run.runId} does not match its planned order or executed model pin`
      );
    }
    if (
      experimentConfig.executionPolicy.timeoutSeconds !== null ||
      experimentConfig.executionPolicy.toolCallCap !== null
    ) {
      throw new Error(`Cannot build measured report: run ${run.runId} does not use the no-timeout execution policy`);
    }
    for (const [label, value] of [
      ["productiveSeconds", execution.productiveSeconds],
      ["queueSeconds", execution.queueSeconds],
      ["inputTokens", execution.inputTokens],
      ["cachedInputTokens", execution.cachedInputTokens],
      ["outputTokens", execution.outputTokens],
      ["reasoningTokens", execution.reasoningTokens]
    ]) {
      if (typeof value !== "number" || value < 0) {
        throw new Error(
          `Cannot build measured report: run ${run.runId} is missing required ${label} measurement`
        );
      }
    }
    seenKeys.add(key);
    seenRunIds.add(run.runId);
  }

  const missing = [...expected.keys()].filter((key) => !seenKeys.has(key));
  if (missing.length > 0) {
    throw new Error(
      `Cannot build measured report: incomplete benchmark matrix; missing ${missing.length} run cell(s): ${missing.join(", ")}`
    );
  }

  for (const episode of experimentConfig.episodes) {
    const episodeRuns = runs.filter((run) => run.episodeId === episode.id);
    const specRuns = episodeRuns.filter((run) => run.inputMode === "spec");
    const rawRuns = episodeRuns.filter((run) => run.inputMode === "raw");
    const specHashes = unique(specRuns.map((run) => run.spec?.sha256));
    if (
      specHashes.length !== 1 ||
      !/^[a-f0-9]{64}$/.test(specHashes[0] ?? "") ||
      rawRuns.some((run) => run.spec !== null)
    ) {
      throw new Error(
        `Cannot build measured report: ${episode.id} must bind one approved spec to mai-spec and no spec to opus-raw`
      );
    }
  }
}

function validateRunSetMetadata(runs, expectedDataKind, expectedBenchmarkVersion) {
  const runDataKind = commonRequired(
    runs.map((run) => run.dataKind),
    "run data kind"
  );
  const runBenchmarkVersion = commonRequired(
    runs.map((run) => run.benchmarkVersion),
    "benchmark version"
  );
  if (runDataKind !== expectedDataKind) {
    throw new Error(
      `Cannot build report: requested dataKind ${expectedDataKind} does not match run dataKind ${runDataKind}`
    );
  }
  if (runBenchmarkVersion !== expectedBenchmarkVersion) {
    throw new Error(
      `Cannot build report: requested benchmarkVersion ${expectedBenchmarkVersion} does not match run benchmarkVersion ${runBenchmarkVersion}`
    );
  }
  return { dataKind: runDataKind, benchmarkVersion: runBenchmarkVersion };
}

function exactClaim(claim) {
  return {
    status: claim.status,
    qualityVerdict: claim.qualityVerdict,
    timeVerdict: claim.timeVerdict,
    tokenVerdict: claim.tokenVerdict,
    efficiencyVerdict: claim.efficiencyVerdict,
    drivingMetric: claim.drivingMetric,
    qualityDelta: claim.qualityDelta,
    productiveTimeDeltaSeconds: claim.productiveTimeDeltaSeconds,
    implementationTokenDelta: claim.implementationTokenDelta,
    costSavingPercent: claim.costSavingPercent,
    message: claim.message
  };
}

function amortizedTokenShare(authoringEffort, repetition) {
  if (!authoringEffort) return 0;
  const total =
    (authoringEffort.inputTokens ?? 0) +
    (authoringEffort.cachedInputTokens ?? 0) +
    (authoringEffort.outputTokens ?? 0) +
    (authoringEffort.reasoningTokens ?? 0);
  const across = authoringEffort.amortizedAcrossRuns;
  if (!Number.isInteger(total) || !Number.isInteger(across) || across <= 0) return 0;
  const base = Math.floor(total / across);
  const remainder = total % across;
  return base + (repetition <= remainder ? 1 : 0);
}

function amortizedTimeShare(authoringEffort) {
  const elapsed = authoringEffort?.elapsedSeconds;
  const across = authoringEffort?.amortizedAcrossRuns;
  return typeof elapsed === "number" &&
    Number.isInteger(across) &&
    across > 0
    ? elapsed / across
    : 0;
}

function normalizeHardGates(run) {
  if (Array.isArray(run.hardGates) && run.hardGates.length > 0) {
    return run.hardGates.map((gate) => {
      if (gate.status) {
        return {
          id: gate.id,
          applicable: gate.applicable,
          status: gate.status,
          reason: gate.reason ?? null
        };
      }
      return {
        id: gate.id,
        applicable: gate.applicable,
        status: gate.applicable ? (gate.passed ? "passed" : "failed") : "not-applicable",
        reason: gate.reason ?? null
      };
    });
  }

  if (run.gateStates && Object.keys(run.gateStates).length > 0) {
    return Object.entries(run.gateStates).map(([id, state]) => ({
      id,
      applicable: state !== "not-applicable",
      status: state,
      reason: null
    }));
  }

  if (run.hardGates && typeof run.hardGates === "object") {
    return Object.entries(run.hardGates).map(([id, passed]) => ({
      id,
      applicable: true,
      status: passed === true ? "passed" : "failed",
      reason: null
    }));
  }

  return [{
    id: "aggregate-hard-gates",
    applicable: true,
    status: run.hardGatesPassed === true ? "passed" : "failed",
    reason: null
  }];
}

function normalizeReportRun(run) {
  const execution = run.execution ?? {};
  const evidence = run.evidence ?? {};
  const evidencePath =
    evidence.directory ??
    run.evidenceDirectory ??
    run.evidencePath ??
    null;
  if (!evidencePath && run.dataKind === "measured") {
    throw new Error(`Cannot build measured report: run ${run.runId} has no evidence path`);
  }
  return {
    runId: run.runId,
    dataKind: run.dataKind,
    laneId: run.laneId,
    modelDisplayName: run.model?.displayName ?? run.modelDisplayName,
    inputMode: run.inputMode,
    repetition: run.repetition,
    status: execution.status ?? run.status,
    qualityScore: run.qualityScore,
    hardGates: normalizeHardGates(run),
    hardGatesPassed: run.hardGatesPassed,
    scores: run.scores,
    elapsedSeconds: execution.elapsedSeconds ?? run.elapsedSeconds,
    productiveSeconds:
      execution.productiveSeconds ??
      execution.productiveDurationSeconds ??
      run.productiveSeconds ??
      run.productiveDurationSeconds ??
      null,
    queueSeconds:
      execution.queueSeconds ??
      execution.queueDurationSeconds ??
      run.queueSeconds ??
      run.queueDurationSeconds ??
      null,
    toolCalls: execution.toolCalls ?? run.toolCalls ?? 0,
    inputTokens: execution.inputTokens ?? run.inputTokens ?? null,
    cachedInputTokens: execution.cachedInputTokens ?? run.cachedInputTokens ?? null,
    outputTokens: execution.outputTokens ?? run.outputTokens ?? null,
    reasoningTokens:
      execution.reasoningTokens ??
      execution.reasoningOutputTokens ??
      run.reasoningTokens ??
      run.reasoningOutputTokens ??
      null,
    estimatedCostUsd: execution.estimatedCostUsd ?? run.estimatedCostUsd ?? null,
    specAuthoringAmortizedCostUsd:
      execution.specAuthoringCostUsd ??
      run.specAuthoringCostUsd ??
      run.specAuthoringAmortizedCostUsd ??
      null,
    specAuthoringAmortizedTokens:
      run.specAuthoringAmortizedTokens ??
      amortizedTokenShare(run.spec?.authoringEffort, run.repetition),
    specAuthoringAmortizedSeconds:
      run.specAuthoringAmortizedSeconds ??
      amortizedTimeShare(run.spec?.authoringEffort),
    evidencePath: evidencePath ?? "evidence/illustrative"
  };
}

function canonicalPromptHashes(experimentConfig, repoRoot) {
  const hashes = new Map();
  for (const episode of experimentConfig.episodes) {
    const briefText = readFileSync(path.join(repoRoot, episode.taskBrief), "utf8");
    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, episode.specBundle, "manifest.json"), "utf8")
    );
    const bundle = loadSpecKitBundle(path.join(repoRoot, episode.specBundle));
    const validation = validateSpecKitBundle(bundle);
    if (
      !validation.valid ||
      hashSpecKitBundle(bundle, {
        id: manifest.id,
        methodologyCommit: manifest.methodology?.commit
      }) !== manifest.sha256
    ) {
      throw new Error(
        `Cannot build measured report: ${episode.id} spec bundle no longer matches its manifest`
      );
    }
    const renderedSpec = renderSpecKitBundle(bundle, { id: manifest.id });
    hashes.set(
      `${episode.id}|raw`,
      hashText(assemblePromptText({ briefText, inputMode: "raw" }))
    );
    hashes.set(
      `${episode.id}|spec`,
      hashText(assemblePromptText({ briefText, inputMode: "spec", renderedSpec }))
    );
  }
  return hashes;
}

function validateBaselinesAgainstFreeze(runs, experimentConfig, freezeRecord) {
  for (const episode of experimentConfig.episodes) {
    const episodeRuns = runs.filter((run) => run.episodeId === episode.id);
    const frozenBaseline = freezeRecord.baselines?.find(
      (baseline) => baseline.episodeId === episode.id
    );
    if (!frozenBaseline) {
      throw new Error(`Cannot build measured report: freeze record has no ${episode.id} baseline`);
    }

    const actual = {
      ref: commonRequired(
        episodeRuns.map((run) => run.baseline?.ref ?? run.baselineRef),
        `${episode.id} baseline ref`
      ),
      commit: commonRequired(
        episodeRuns.map((run) => run.baseline?.commit ?? run.baselineCommit),
        `${episode.id} baseline commit`
      ),
      sha256: commonRequired(
        episodeRuns.map((run) => run.baseline?.sha256 ?? run.baselineSha256),
        `${episode.id} baseline content hash`
      )
    };
    if (
      actual.ref !== frozenBaseline.ref ||
      actual.commit !== frozenBaseline.commit ||
      actual.sha256 !== frozenBaseline.sha256
    ) {
      throw new Error(`Cannot build measured report: ${episode.id} baseline does not match the freeze record`);
    }
  }
}

export function validateSpecHashesAgainstFreeze(runs, experimentConfig, freezeRecord) {
  for (const episode of experimentConfig.episodes) {
    const frozenSpec = freezeRecord.promptsAndSpecs?.find(
      (entry) => entry.episodeId === episode.id
    );
    const expectedSha256 = frozenSpec?.assembledSpecSha256;
    if (!/^[a-f0-9]{64}$/.test(expectedSha256 ?? "")) {
      throw new Error(
        `Cannot build measured report: freeze record has no approved specification hash for ${episode.id}`
      );
    }
    const mismatchedSpec = runs.filter(
      (run) =>
        run.episodeId === episode.id &&
        run.inputMode === "spec" &&
        run.spec?.sha256 !== expectedSha256
    );
    const rawWithSpec = runs.filter(
      (run) =>
        run.episodeId === episode.id &&
        run.inputMode === "raw" &&
        run.spec !== null
    );
    if (mismatchedSpec.length > 0 || rawWithSpec.length > 0) {
      throw new Error(
        `Cannot build measured report: ${episode.id} spec assignment does not match the freeze record`
      );
    }
  }
}

function resolveMeasuredArtifactPath(artifactPath, repoRoot, label) {
  if (typeof artifactPath !== "string" || artifactPath.length === 0) {
    throw new Error(`Measured run has no ${label} path`);
  }
  const root = path.resolve(repoRoot);
  const resolved = path.resolve(root, artifactPath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Measured ${label} escapes the repository root: ${artifactPath}`);
  }
  return resolved;
}

function assertArtifactHash(filePath, expectedSha256, runId, label) {
  if (hashFile(filePath) !== expectedSha256) {
    throw new Error(`Measured ${label} hash mismatch for run ${runId}`);
  }
}

function recomputeMeasuredRun(run, { scoringConfig, costsConfig, repoRoot, freezeRecord }) {
  const evaluatorPath = resolveMeasuredArtifactPath(
    run.evidence?.evaluatorPath ?? run.evaluatorPath,
    repoRoot,
    "evaluator evidence"
  );
  const transcriptPath = resolveMeasuredArtifactPath(
    run.evidence?.transcriptPath,
    repoRoot,
    "transcript evidence"
  );
  const diffPath = resolveMeasuredArtifactPath(run.source?.diffPath, repoRoot, "source diff");
  const bundlePath = resolveMeasuredArtifactPath(
    run.source?.bundlePath,
    repoRoot,
    "source bundle"
  );
  assertArtifactHash(evaluatorPath, run.evidence?.evaluatorSha256, run.runId, "evaluator evidence");
  assertArtifactHash(transcriptPath, run.evidence?.transcriptSha256, run.runId, "transcript evidence");
  assertArtifactHash(diffPath, run.source?.diffSha256, run.runId, "source diff");
  assertArtifactHash(bundlePath, run.source?.bundleSha256, run.runId, "source bundle");
  const bundleHeads = execFileSync(
    "git",
    ["bundle", "list-heads", bundlePath],
    { encoding: "utf8" }
  );
  if (!bundleHeads.split(/\r?\n/).some((line) => line.startsWith(`${run.source.commit} `))) {
    throw new Error(`Measured source bundle does not contain commit ${run.source.commit}`);
  }
  const evaluator = JSON.parse(readFileSync(evaluatorPath, "utf8"));
  const execution = run.execution ?? {};
  const executionStatus = execution.status ?? run.status;
  const scored = scoreRun(evaluator, {
    scoringConfig,
    episodeId: run.episodeId,
    executionStatus,
    inputMode: run.inputMode
  });
  const authoringEffort =
    run.inputMode === "spec"
      ? freezeRecord.promptsAndSpecs.find((entry) => entry.episodeId === run.episodeId)
          ?.specAuthoringEffort ?? null
      : null;
  const normalizedAuthoringEffort = authoringEffort
    ? {
        elapsedSeconds:
          authoringEffort.elapsedSeconds ??
          Math.round((authoringEffort.elapsedMinutes ?? 0) * 60),
        inputTokens: authoringEffort.uncachedInputTokens ?? authoringEffort.inputTokens ?? 0,
        cachedInputTokens: authoringEffort.cachedInputTokens ?? 0,
        outputTokens: authoringEffort.outputTokens ?? 0,
        reasoningTokens: authoringEffort.reasoningTokens ?? 0,
        estimatedCostUsd: authoringEffort.estimatedCostUsd ?? null,
        costEvidenceRef: authoringEffort.costEvidenceRef ?? null,
        costMethod: authoringEffort.costMethod ?? null,
        amortizedAcrossRuns: freezeRecord.repetitionsPerLane
      }
    : null;
  const authoringShareUsd = amortizedSpecAuthoringShareUsd(
    authoringEffort,
    freezeRecord.repetitionsPerLane
  );
  const estimatedCostUsd = computeCostUsd({
    modelId: run.model?.id ?? run.modelId,
    inputTokens: execution.inputTokens ?? run.inputTokens,
    outputTokens: execution.outputTokens ?? run.outputTokens,
    cachedInputTokens: execution.cachedInputTokens ?? run.cachedInputTokens ?? 0,
    reasoningOutputTokens:
      execution.reasoningTokens ??
      execution.reasoningOutputTokens ??
      run.reasoningTokens ??
      run.reasoningOutputTokens ??
      0,
    costsConfig,
    specAuthoringShareUsd: authoringShareUsd,
    requiresSpecAuthoringCost: run.inputMode === "spec"
  });

  return {
    ...run,
    spec:
      run.inputMode === "spec"
        ? { ...run.spec, authoringEffort: normalizedAuthoringEffort }
        : null,
    qualityScore: scored.qualityScore,
    hardGates: null,
    hardGatesPassed: scored.hardGatesPassed,
    gateStates: scored.gateStates,
    scores: scored.scores,
    execution: {
      ...execution,
      estimatedCostUsd,
      specAuthoringCostUsd: authoringShareUsd
    },
    estimatedCostUsd,
    specAuthoringCostUsd: authoringShareUsd
  };
}

function exactLaneSummary(summary) {
  return {
    laneId: summary.laneId,
    modelDisplayName: summary.modelDisplayName,
    inputMode: summary.inputMode,
    qualityMedian: summary.qualityMedian,
    qualityMin: summary.qualityMin,
    qualityMax: summary.qualityMax,
    hardGatePassCount: summary.hardGatePassCount,
    hardGateFailCount: summary.hardGateFailCount,
    runCount: summary.runCount,
    elapsedMedianSeconds: summary.elapsedMedianSeconds,
    productiveMedianSeconds: summary.productiveMedianSeconds,
    endToEndProductiveMedianSeconds:
      summary.endToEndProductiveMedianSeconds,
    uncachedInputTokenMedian: summary.uncachedInputTokenMedian,
    cachedInputTokenMedian: summary.cachedInputTokenMedian,
    outputTokenMedian: summary.outputTokenMedian,
    reasoningTokenMedian: summary.reasoningTokenMedian,
    implementationTokenMedian: summary.implementationTokenMedian,
    endToEndTokenMedian: summary.endToEndTokenMedian,
    tokenMedian: summary.tokenMedian,
    costMedianUsd: summary.costMedianUsd
  };
}

function frozenVersionLabels(runs, experimentConfig, dataKind) {
  if (dataKind !== "measured") {
    return unique([
      ...runs.map((run) => run.baseline?.ref ?? run.baselineRef),
      ...runs.map((run) => run.model?.buildId ?? run.modelBuildId),
      ...runs.map((run) => run.execution?.agentVersion ?? run.agentVersion),
      ...runs.map((run) => run.model?.displayName ?? run.modelDisplayName)
    ]);
  }

  const labels = [];
  for (const episode of experimentConfig.episodes) {
    const episodeRuns = runs.filter((run) => run.episodeId === episode.id);
    const baselineRef = commonRequired(
      episodeRuns.map((run) => run.baseline?.ref ?? run.baselineRef),
      `${episode.id} baseline ref`
    );
    const baselineCommit = commonRequired(
      episodeRuns.map((run) => run.baseline?.commit ?? run.baselineCommit),
      `${episode.id} baseline commit`
    );
    commonRequired(
      episodeRuns.map((run) => run.baseline?.sha256 ?? run.baselineSha256),
      `${episode.id} baseline content hash`
    );
    if (baselineRef !== episode.baselineRef) {
      throw new Error(
        `Cannot build measured report: ${episode.id} baseline ref does not match the experiment config`
      );
    }
    labels.push(`baseline:${episode.id}:${baselineRef}@${baselineCommit}`);
  }

  for (const [tier, configuredModel] of Object.entries(experimentConfig.models)) {
    const modelRuns = runs.filter(
      (run) => (run.model?.id ?? run.modelId) === configuredModel.id
    );
    if (modelRuns.length === 0) {
      throw new Error(`Cannot build measured report: no runs use frozen ${tier} model`);
    }
    const buildId = commonRequired(
      modelRuns.map((run) => run.model?.buildId ?? run.modelBuildId),
      `${tier} model build`
    );
    const agentVersion = commonRequired(
      modelRuns.map((run) => run.execution?.agentVersion ?? run.agentVersion),
      `${tier} agent version`
    );
    const agentBuildId = commonRequired(
      modelRuns.map((run) => run.execution?.agentBuildId ?? run.agentBuildId),
      `${tier} agent build`
    );
    const reasoningEffort = commonRequired(
      modelRuns.map((run) => run.execution?.reasoningEffort ?? run.reasoningEffort),
      `${tier} reasoning effort`
    );
    if (
      buildId !== configuredModel.buildId ||
      agentVersion !== configuredModel.agentVersion ||
      agentBuildId !== configuredModel.agentBuildId ||
      reasoningEffort !== configuredModel.effortParams?.reasoningEffort
    ) {
      throw new Error(`Cannot build measured report: ${tier} execution pins do not match the experiment config`);
    }
    labels.push(
      `model:${configuredModel.id}:${buildId};agent:${agentVersion}/${agentBuildId};reasoning:${reasoningEffort}`
    );
  }

  return labels;
}

export function buildReport({
  runs,
  benchmarkVersion = "unfrozen",
  repetitionsPerLane = 3,
  dataKind = "illustrative",
  pricingAsOf = null,
  generatedAt = new Date().toISOString(),
  experimentConfig = loadExperimentConfig(),
  scoringConfig = loadScoringConfig(),
  costsConfig = loadCostsConfig(),
  evaluatorSha256 = hashDirectory(path.join(REPO_ROOT, "evaluator")),
  scoringConfigSha256 = hashFile(path.join(CONFIG_DIR, "scoring.json")),
  costsConfigSha256 = hashFile(path.join(CONFIG_DIR, "costs.json")),
  benchmarkEngineSha256 = hashDirectory(path.join(REPO_ROOT, "benchmark", "src")),
  experimentConfigSha256 = null,
  runSchemaSha256 = hashFile(path.join(CONTRACTS_DIR, "run.schema.json")),
  reportSchemaSha256 = hashFile(path.join(CONTRACTS_DIR, "report.schema.json")),
  expectedPromptHashes = null,
  freezeRecord = null,
  freezeRecordPath = null,
  repoRoot = REPO_ROOT
}) {
  if (runs.length === 0) {
    throw new Error("Cannot build a report from an empty run list");
  }
  const effectiveExperimentConfigSha256 =
    experimentConfigSha256 ??
    hashFile(getExperimentConfigPath(experimentConfig.benchmarkVersion));

  const metadata = validateRunSetMetadata(runs, dataKind, benchmarkVersion);
  if (metadata.dataKind === "measured") {
    const runSchema = loadRunSchema();
    for (const run of runs) {
      const { valid, errors } = validateAgainstSchema(runSchema, run);
      if (!valid) {
        throw new Error(
          `Cannot build measured report: run ${run.runId ?? "<unknown>"} fails the run contract:\n${errors.map((error) => `  - ${error}`).join("\n")}`
        );
      }
    }
    validateMeasuredReportSet(runs, experimentConfig);
    if (repetitionsPerLane !== experimentConfig.repetitionsPerLane) {
      throw new Error("Cannot build measured report: repetitionsPerLane does not match the experiment config");
    }
  }
  const versionLabels = frozenVersionLabels(runs, experimentConfig, metadata.dataKind);
  const frozenHash = metadata.dataKind === "measured" ? commonRequired : commonNullable;
  const freezeRecordHash = frozenHash(
    runs.map((run) => run.frozenInputs?.freezeRecordSha256),
    "freeze record hash"
  );
  let trustedFreezeRecord = null;
  if (metadata.dataKind === "measured") {
    if (freezeRecord) {
      trustedFreezeRecord = freezeRecord;
    } else if (freezeRecordPath) {
      const resolvedFreezePath = path.isAbsolute(freezeRecordPath)
        ? freezeRecordPath
        : path.join(repoRoot, freezeRecordPath);
      trustedFreezeRecord = JSON.parse(readFileSync(resolvedFreezePath, "utf8"));
    } else {
      throw new Error("Cannot build measured report: freezeRecordPath is required");
    }
    assertUsableFreezeRecord(trustedFreezeRecord, freezeRecordHash);
    if (
      trustedFreezeRecord.benchmarkVersion !== metadata.benchmarkVersion ||
      trustedFreezeRecord.repetitionsPerLane !== repetitionsPerLane
    ) {
      throw new Error("Cannot build measured report: freeze record version or repetitions do not match");
    }
    if (
      JSON.stringify(scoringConfig) !==
      JSON.stringify(trustedFreezeRecord.frozenInputs?.scoringConfig)
    ) {
      throw new Error("Cannot build measured report: scoring configuration object does not match the freeze record");
    }
    validateBaselinesAgainstFreeze(runs, experimentConfig, trustedFreezeRecord);
    validateSpecHashesAgainstFreeze(runs, experimentConfig, trustedFreezeRecord);
  }
  const trustedCostsConfig =
    metadata.dataKind === "measured"
      ? trustedFreezeRecord.frozenInputs.costsConfig
      : costsConfig;
  if (
    metadata.dataKind === "measured" &&
    JSON.stringify(costsConfig) !== JSON.stringify(trustedCostsConfig)
  ) {
    throw new Error("Cannot build measured report: costs configuration object does not match the freeze record");
  }
  if (
    metadata.dataKind === "measured" &&
    (
      trustedFreezeRecord.pricing?.pricingAsOf !== trustedCostsConfig.pricingAsOf ||
      trustedFreezeRecord.pricing?.rateType !== trustedCostsConfig.rateType ||
      trustedFreezeRecord.pricing?.source !== trustedCostsConfig.source
    )
  ) {
    throw new Error("Cannot build measured report: freeze pricing summary does not match its costs configuration");
  }
  const effectiveRuns =
    metadata.dataKind === "measured"
      ? runs.map((run) =>
          recomputeMeasuredRun(run, {
            scoringConfig,
            costsConfig: trustedCostsConfig,
            repoRoot,
            freezeRecord: trustedFreezeRecord
          })
        )
      : runs;
  if (metadata.dataKind === "measured") {
    for (const run of effectiveRuns) {
      const status = run.execution?.status ?? run.status;
      if (
        status !== "completed" &&
        (run.qualityScore !== 0 || run.hardGatesPassed !== false)
      ) {
        throw new Error(
          `Cannot build measured report: non-completed run ${run.runId} was not normalized to zero score and failed gates`
        );
      }
    }
  }

  const byEpisode = new Map();
  for (const run of effectiveRuns) {
    if (!byEpisode.has(run.episodeId)) byEpisode.set(run.episodeId, []);
    byEpisode.get(run.episodeId).push(run);
  }

  const normalizedByEpisode = new Map();
  for (const [episodeId, episodeRuns] of byEpisode.entries()) {
    normalizedByEpisode.set(
      episodeId,
      episodeRuns.map((run) => normalizeReportRun(run))
    );
  }
  const reportRuns = [...normalizedByEpisode.values()].flat();

  const claimInput = [...byEpisode.entries()].flatMap(([episodeId, episodeRuns]) =>
    episodeRuns.map((run, index) => ({
      ...normalizedByEpisode.get(episodeId)[index],
      episodeId
    }))
  );
  const fullClaim = determineClaim(claimInput, {
    claimRule: scoringConfig.claimRule,
    secondaryClaimRules: scoringConfig.secondaryClaimRules ?? [],
    dataKind: metadata.dataKind,
    pricingAsOf:
      metadata.dataKind === "measured"
        ? trustedFreezeRecord.pricing?.pricingAsOf ?? null
        : costsConfig.pricingAsOf ?? null,
    episodeOrder: experimentConfig.episodes.map((episode) => episode.id)
  });

  const episodes = experimentConfig.episodes
    .map((episodeConfig) => {
      const episodeRuns = normalizedByEpisode.get(episodeConfig.id);
      if (!episodeRuns) return null;
      const episodeClaim = fullClaim.episodeClaims.find(
        (claim) => claim.episodeId === episodeConfig.id
      );
      return {
        id: episodeConfig.id,
        name: episodeConfig.name,
        claim: exactClaim(episodeClaim),
        laneSummaries: aggregateEpisode(episodeRuns).map(exactLaneSummary),
        runs: episodeRuns
      };
    })
    .filter(Boolean);

  const evaluatorHash =
    frozenHash(
      runs.map((run) => run.frozenInputs?.evaluatorSha256),
      "evaluator hash"
    ) ?? evaluatorSha256;
  const scoringHash =
    frozenHash(
      runs.map((run) => run.frozenInputs?.scoringConfigSha256),
      "scoring config hash"
    ) ?? scoringConfigSha256;
  const costsHash =
    frozenHash(
      runs.map((run) => run.frozenInputs?.costsConfigSha256),
      "costs config hash"
    ) ?? costsConfigSha256;
  const experimentHash =
    frozenHash(
      runs.map((run) => run.frozenInputs?.experimentConfigSha256),
      "experiment config hash"
    ) ?? effectiveExperimentConfigSha256;
  const benchmarkEngineHash =
    frozenHash(
      runs.map((run) => run.frozenInputs?.benchmarkEngineSha256),
      "benchmark engine hash"
    ) ?? benchmarkEngineSha256;
  const runContractHash =
    frozenHash(
      runs.map((run) => run.frozenInputs?.runSchemaSha256),
      "run schema hash"
    ) ?? runSchemaSha256;
  const reportContractHash =
    frozenHash(
      runs.map((run) => run.frozenInputs?.reportSchemaSha256),
      "report schema hash"
    ) ?? reportSchemaSha256;
  const promptHashes = [];
  const canonicalPrompts =
    metadata.dataKind === "measured"
      ? expectedPromptHashes ?? canonicalPromptHashes(experimentConfig, repoRoot)
      : null;
  const frozenPrompts = new Map();
  for (const entry of trustedFreezeRecord?.promptsAndSpecs ?? []) {
    frozenPrompts.set(`${entry.episodeId}|raw`, entry.rawPromptSha256);
    frozenPrompts.set(`${entry.episodeId}|spec`, entry.specPromptSha256);
  }
  for (const episode of experimentConfig.episodes) {
    for (const inputMode of ["raw", "spec"]) {
      const matchingRuns = runs.filter(
        (run) => run.episodeId === episode.id && run.inputMode === inputMode
      );
      if (matchingRuns.length === 0) continue;
      const promptHash =
        metadata.dataKind === "measured"
          ? commonRequired(
              matchingRuns.map((run) => run.frozenInputs?.promptSha256),
              `${episode.id}/${inputMode} prompt hash`
            )
          : commonNullable(
              matchingRuns.map((run) => run.frozenInputs?.promptSha256),
              `${episode.id}/${inputMode} prompt hash`
            );
      if (promptHash) promptHashes.push(promptHash);
      if (
        metadata.dataKind === "measured" &&
        (
          promptHash !== canonicalPrompts.get(`${episode.id}|${inputMode}`) ||
          promptHash !== frozenPrompts.get(`${episode.id}|${inputMode}`)
        )
      ) {
        throw new Error(
          `Cannot build measured report: ${episode.id}/${inputMode} prompt hash does not match the frozen canonical prompt`
        );
      }
    }
  }
  if (metadata.dataKind === "measured" && scoringHash !== scoringConfigSha256) {
    throw new Error("Cannot build measured report: current scoring configuration does not match frozen runs");
  }
  if (metadata.dataKind === "measured" && evaluatorHash !== evaluatorSha256) {
    throw new Error("Cannot build measured report: current evaluator does not match frozen runs");
  }
  if (metadata.dataKind === "measured" && costsHash !== costsConfigSha256) {
    throw new Error("Cannot build measured report: current costs configuration does not match frozen runs");
  }
  if (
    metadata.dataKind === "measured" &&
    experimentHash !== effectiveExperimentConfigSha256
  ) {
    throw new Error("Cannot build measured report: current experiment configuration does not match frozen runs");
  }
  if (metadata.dataKind === "measured" && benchmarkEngineHash !== benchmarkEngineSha256) {
    throw new Error("Cannot build measured report: current benchmark engine does not match frozen runs");
  }
  if (metadata.dataKind === "measured" && runContractHash !== runSchemaSha256) {
    throw new Error("Cannot build measured report: current run contract does not match frozen runs");
  }
  if (metadata.dataKind === "measured" && reportContractHash !== reportSchemaSha256) {
    throw new Error("Cannot build measured report: current report contract does not match frozen runs");
  }
  if (metadata.dataKind === "measured") {
    const recordInputs = trustedFreezeRecord.frozenInputs;
    const expectedInputs = {
      evaluatorSha256: evaluatorHash,
      scoringConfigSha256: scoringHash,
      costsConfigSha256: costsHash,
      experimentConfigSha256: experimentHash,
      benchmarkEngineSha256: benchmarkEngineHash,
      runSchemaSha256: runContractHash,
      reportSchemaSha256: reportContractHash
    };
    for (const [label, expectedHash] of Object.entries(expectedInputs)) {
      if (recordInputs?.[label] !== expectedHash) {
        throw new Error(`Cannot build measured report: ${label} does not match the freeze record`);
      }
    }
  }
  if (
    metadata.dataKind === "measured" &&
    pricingAsOf !== null &&
    pricingAsOf !== trustedFreezeRecord.pricing?.pricingAsOf
  ) {
    throw new Error("Cannot build measured report: pricingAsOf override does not match the frozen costs configuration");
  }

  const report = {
    schemaVersion: "1.1.0",
    metadata: {
      benchmarkVersion: metadata.benchmarkVersion,
      generatedAt,
      dataKind: metadata.dataKind,
      evidenceQualification:
        metadata.dataKind === "measured"
          ? trustedFreezeRecord.evidenceQualification
          : {
              level: "illustrative",
              limitation:
                "Synthetic playback data has not been produced by controlled coding-agent runs and cannot support a benchmark claim."
            },
      repetitionsPerLane,
      executionPolicy:
        metadata.dataKind === "measured"
          ? {
              timeoutSeconds: trustedFreezeRecord.executionPolicy.timeoutSeconds,
              toolCallCap: trustedFreezeRecord.executionPolicy.toolCallCap,
              completionBoundary:
                trustedFreezeRecord.executionPolicy.completionBoundary
            }
          : {
              timeoutSeconds: experimentConfig.executionPolicy.timeoutSeconds,
              toolCallCap: experimentConfig.executionPolicy.toolCallCap,
              completionBoundary:
                experimentConfig.executionPolicy.completionBoundary
            },
      pricingAsOf:
        metadata.dataKind === "measured"
          ? trustedFreezeRecord.pricing?.pricingAsOf ?? null
          : pricingAsOf ?? costsConfig.pricingAsOf ?? null,
      rateType:
        metadata.dataKind === "measured"
          ? trustedFreezeRecord.pricing?.rateType ?? "unavailable"
          : costsConfig.rateType ?? "unavailable",
      frozenInputs: {
        freezeRecordSha256: freezeRecordHash,
        evaluatorSha256: evaluatorHash,
        scoringConfigSha256: scoringHash,
        costsConfigSha256: costsHash,
        benchmarkEngineSha256: benchmarkEngineHash,
        promptSha256s: unique(promptHashes),
        experimentConfigSha256: experimentHash,
        runSchemaSha256: runContractHash,
        reportSchemaSha256: reportContractHash,
        claimRule:
          metadata.dataKind === "measured"
            ? trustedFreezeRecord.frozenInputs.claimRule
            : scoringConfig.claimRule
      },
      frozenVersions: versionLabels
    },
    overallClaim: exactClaim(fullClaim),
    episodes
  };

  const schema = loadReportSchema();
  const { valid, errors } = validateAgainstSchema(schema, report);
  if (!valid) {
    throw new Error(`Generated report failed contracts/report.schema.json validation:\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  }

  return {
    report,
    claimDetail: {
      schemaVersion: "1.1.0",
      generatedAt,
      dataKind: metadata.dataKind,
      overall: exactClaim(fullClaim),
      episodeClaims: fullClaim.episodeClaims,
      secondaryClaims: fullClaim.secondaryClaims
    }
  };
}

export function writeReport(report, outputPath) {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return outputPath;
}

export function writeClaimDetail(claimDetail, outputPath) {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(claimDetail, null, 2)}\n`, "utf8");
  return outputPath;
}
