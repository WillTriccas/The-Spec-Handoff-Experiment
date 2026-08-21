import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  lstatSync
} from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { validateAgainstSchema } from "./schema-lite.js";
import {
  loadRunSchema,
  loadExperimentConfig,
  loadCostsConfig,
  CONFIG_DIR,
  CONTRACTS_DIR,
  REPO_ROOT
} from "./config.js";
import { hashDirectory, hashFile } from "./prepare.js";
import { computeCostUsd, amortizedSpecAuthoringShareUsd } from "./cost.js";
import { assertUsableFreezeRecord } from "./freeze.js";
import { assignRandomizedOrder, buildPlannedRuns } from "./runs.js";

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertRealPathInside(root, candidate, label) {
  const realRoot = realpathSync.native(root);
  const realCandidate = realpathSync.native(candidate);
  if (!isPathInside(realRoot, realCandidate)) {
    throw new Error(`${label} escapes the prepared run directory`);
  }
  return realCandidate;
}

function resolveRunPath(value, label, { repoRoot, runRoot, forWrite = false }) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty path`);
  }
  const resolved = path.resolve(path.isAbsolute(value) ? value : path.join(repoRoot, value));
  if (!isPathInside(runRoot, resolved)) {
    throw new Error(`${label} escapes the prepared run directory`);
  }
  if (forWrite) {
    mkdirSync(path.dirname(resolved), { recursive: true });
    assertRealPathInside(runRoot, path.dirname(resolved), `${label} parent`);
    if (existsSync(resolved)) {
      assertRealPathInside(runRoot, resolved, label);
    }
  } else {
    assertRealPathInside(runRoot, resolved, label);
  }
  return resolved;
}

function resolveFreezeRecordPath(value, repoRoot, runRoot) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Measured imports require freezeRecordPath");
  }
  const resolved = path.resolve(path.isAbsolute(value) ? value : path.join(repoRoot, value));
  if (!existsSync(resolved)) {
    throw new Error(`Freeze record does not exist: ${resolved}`);
  }
  const realResolved = realpathSync.native(resolved);
  const allowedRoots = [repoRoot, runRoot]
    .filter((root) => existsSync(root))
    .map((root) => realpathSync.native(root));
  if (!allowedRoots.some((root) => isPathInside(root, realResolved))) {
    throw new Error("Freeze record escapes the repository and prepared run directory");
  }
  return resolved;
}

function hashGitRootAtRef(workspaceDir, ref) {
  const files = execFileSync(
    "git",
    ["ls-tree", "-r", "-z", "--name-only", ref],
    { cwd: workspaceDir }
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort();
  if (files.length === 0) {
    throw new Error(`Workspace baseline commit ${ref} has no tracked files`);
  }
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file, "utf8");
    hash.update("\0");
    hash.update(execFileSync("git", ["show", `${ref}:${file}`], { cwd: workspaceDir }));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function validateMeasuredPlan(plan, experimentConfig) {
  const plannedRuns = assignRandomizedOrder(buildPlannedRuns(experimentConfig));
  const expected = plannedRuns.find((run) => run.runId === plan.runId);
  if (!expected) {
    throw new Error(`Measured plan references unknown runId "${plan.runId}"`);
  }
  const fields = [
    ["episodeId", plan.episodeId, expected.episodeId],
    ["laneId", plan.laneId, expected.laneId],
    ["inputMode", plan.inputMode, expected.inputMode],
    ["repetition", plan.repetition, expected.repetition],
    ["model tier", plan.model?.tier, expected.modelTier],
    ["model id", plan.model?.id, expected.modelId],
    ["baseline ref", plan.baseline?.ref, expected.baselineRef],
    ["task brief", plan.brief?.path, expected.taskBrief],
    ["execution order", plan.executionOrder, expected.executionOrder]
  ];
  for (const [label, actual, expectedValue] of fields) {
    assertFrozenMatch(actual, expectedValue, `registered ${label}`);
  }
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function assertFrozenMatch(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `Measured import does not match frozen ${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
    );
  }
}

function assertFrozenObjectMatch(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Measured import does not match frozen ${label}`);
  }
}

function validateMeasuredFreeze({
  freezeRecordPath,
  freezeRecordSha256,
  benchmarkVersion,
  plan,
  baselineCommit,
  execution,
  existingProvenance,
  repoRoot,
  runRoot
}) {
  const resolvedPath = resolveFreezeRecordPath(freezeRecordPath, repoRoot, runRoot);

  const freezeRecord = JSON.parse(readFileSync(resolvedPath, "utf8"));
  assertUsableFreezeRecord(freezeRecord, freezeRecordSha256);
  assertFrozenMatch(benchmarkVersion, freezeRecord.benchmarkVersion, "benchmark version");

  const baseline = freezeRecord.baselines?.find(
    (entry) => entry.episodeId === plan.episodeId
  );
  if (!baseline) {
    throw new Error(`Freeze record has no baseline for episode ${plan.episodeId}`);
  }
  assertFrozenMatch(plan.baseline.ref, baseline.ref, "baseline ref");
  assertFrozenMatch(baselineCommit, baseline.commit, "baseline commit");
  assertFrozenMatch(plan.baseline.sha256, baseline.sha256, "baseline content hash");

  const promptAndSpec = freezeRecord.promptsAndSpecs?.find(
    (entry) => entry.episodeId === plan.episodeId
  );
  if (!promptAndSpec) {
    throw new Error(`Freeze record has no prompt/spec entry for episode ${plan.episodeId}`);
  }
  assertFrozenMatch(plan.brief?.sha256, promptAndSpec.taskBriefSha256, "task brief hash");
  assertFrozenMatch(
    existingProvenance.hashes?.taskBriefSha256,
    promptAndSpec.taskBriefSha256,
    "prepared task brief hash"
  );
  const frozenPromptSha256 =
    plan.inputMode === "spec"
      ? promptAndSpec.specPromptSha256
      : promptAndSpec.rawPromptSha256;
  assertFrozenMatch(plan.promptSha256, frozenPromptSha256, "planned prompt hash");
  assertFrozenMatch(
    existingProvenance.hashes?.promptSha256,
    frozenPromptSha256,
    "prepared prompt hash"
  );
  assertFrozenMatch(hashFile(plan.promptPath), frozenPromptSha256, "prompt file hash");
  if (plan.spec) {
    assertFrozenMatch(plan.spec.sha256, promptAndSpec.assembledSpecSha256, "assembled spec hash");
    assertFrozenMatch(
      existingProvenance.hashes?.specManifestSha256,
      promptAndSpec.specManifestSha256,
      "spec manifest hash"
    );
    const frozenEffort = promptAndSpec.specAuthoringEffort;
    assertFrozenObjectMatch(
      plan.spec.authoringEffort,
      {
        elapsedSeconds:
          frozenEffort?.elapsedSeconds ??
          Math.round((frozenEffort?.elapsedMinutes ?? 0) * 60),
        inputTokens: frozenEffort?.uncachedInputTokens ?? frozenEffort?.inputTokens ?? 0,
        cachedInputTokens: frozenEffort?.cachedInputTokens ?? 0,
        outputTokens: frozenEffort?.outputTokens ?? 0,
        reasoningTokens: frozenEffort?.reasoningTokens ?? 0,
        estimatedCostUsd: frozenEffort?.estimatedCostUsd ?? null,
        costEvidenceRef: frozenEffort?.costEvidenceRef ?? null,
        costMethod: frozenEffort?.costMethod ?? null,
        amortizedAcrossRuns: freezeRecord.repetitionsPerLane
      },
      "specification authoring effort"
    );
  }

  const frozenModel = freezeRecord.models?.find(
    (entry) => entry.tier === plan.model.tier && entry.id === plan.model.id
  );
  if (!frozenModel) {
    throw new Error(`Freeze record has no model pin for ${plan.model.tier}/${plan.model.id}`);
  }
  assertFrozenMatch(plan.model.buildId, frozenModel.buildId, "model build");
  assertFrozenMatch(execution.modelId, frozenModel.id, "executed model id");
  assertFrozenMatch(execution.modelBuildId, frozenModel.buildId, "executed model build");
  assertFrozenMatch(plan.model.agentVersion, frozenModel.agentVersion, "planned agent version");
  assertFrozenMatch(plan.model.agentBuildId, frozenModel.agentBuildId, "planned agent build");
  assertFrozenMatch(
    plan.model.effortParams?.reasoningEffort,
    frozenModel.effortParams?.reasoningEffort,
    "planned reasoning effort"
  );
  assertFrozenMatch(execution.agentVersion, frozenModel.agentVersion, "executed agent version");
  assertFrozenMatch(execution.agentBuildId, frozenModel.agentBuildId, "executed agent build");
  assertFrozenMatch(
    execution.reasoningEffort,
    frozenModel.effortParams?.reasoningEffort,
    "executed reasoning effort"
  );
  assertFrozenMatch(execution.order, plan.executionOrder, "execution order");
  assertFrozenObjectMatch(
    plan.executionPolicySnapshot,
    freezeRecord.executionPolicy,
    "execution policy"
  );
  const policy = freezeRecord.executionPolicy ?? {};
  if (policy.timeoutSeconds !== null || policy.toolCallCap !== null) {
    throw new Error(
      "Measured run requires the frozen no-timeout, no-tool-call-cap policy"
    );
  }

  const frozenInputs = freezeRecord.frozenInputs ?? {};
  const currentHashes = {
    evaluatorSha256: hashDirectory(path.join(repoRoot, "evaluator")),
    scoringConfigSha256: hashFile(path.join(CONFIG_DIR, "scoring.json")),
    experimentConfigSha256: hashFile(path.join(CONFIG_DIR, "experiment.json")),
    costsConfigSha256: hashFile(path.join(CONFIG_DIR, "costs.json")),
    benchmarkEngineSha256: hashDirectory(path.join(repoRoot, "benchmark", "src")),
    runSchemaSha256: hashFile(path.join(CONTRACTS_DIR, "run.schema.json")),
    reportSchemaSha256: hashFile(path.join(CONTRACTS_DIR, "report.schema.json"))
  };
  for (const [label, currentHash] of Object.entries(currentHashes)) {
    assertFrozenMatch(currentHash, frozenInputs[label], label);
  }
  assertFrozenMatch(
    existingProvenance.hashes?.evaluatorSha256,
    frozenInputs.evaluatorSha256,
    "prepared evaluator hash"
  );
  assertFrozenMatch(
    existingProvenance.hashes?.scoringConfigSha256,
    frozenInputs.scoringConfigSha256,
    "prepared scoring config hash"
  );
  assertFrozenMatch(
    existingProvenance.hashes?.experimentConfigSha256,
    frozenInputs.experimentConfigSha256,
    "prepared experiment config hash"
  );
  assertFrozenMatch(
    existingProvenance.hashes?.costsConfigSha256,
    frozenInputs.costsConfigSha256,
    "prepared costs config hash"
  );
  assertFrozenMatch(
    existingProvenance.hashes?.benchmarkEngineSha256,
    frozenInputs.benchmarkEngineSha256,
    "prepared benchmark engine hash"
  );
  assertFrozenMatch(
    existingProvenance.hashes?.runSchemaSha256,
    frozenInputs.runSchemaSha256,
    "prepared run contract hash"
  );
  assertFrozenMatch(
    existingProvenance.hashes?.reportSchemaSha256,
    frozenInputs.reportSchemaSha256,
    "prepared report contract hash"
  );

  return { freezeRecord, resolvedPath };
}

/**
 * Look up the approved spec bundle's `authoringEffort` (from its
 * spec-factory `manifest.json`) for a given episode, so that a spec-lane
 * run's cost can include an amortized share of the one-time spec-authoring
 * investment (correction item 6). Returns null if the episode has no
 * configured spec bundle or the bundle has no manifest.json yet.
 */
function loadSpecAuthoringEffort(episodeId, experimentConfig, repoRoot) {
  const episode = experimentConfig.episodes.find((e) => e.id === episodeId);
  if (!episode?.specBundle) return null;
  const manifestPath = path.join(repoRoot, episode.specBundle, "manifest.json");
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return manifest.authoringEffort ?? null;
}

/**
 * Assert that an assembled (schema-valid) run's lane/inputMode/spec
 * presence and model tier/id are mutually consistent with the committed
 * experiment config, per correction item 8. This runs *after* schema
 * validation succeeds so a structurally invalid run (e.g. an unknown
 * laneId) still fails with the original schema error rather than being
 * masked by this check.
 */
function validateImportedRunConsistency(run, experimentConfig) {
  const lane = experimentConfig.lanes.find((l) => l.id === run.laneId);
  if (!lane) {
    throw new Error(`Imported run "${run.runId}" references unknown lane "${run.laneId}"`);
  }
  if (lane.inputMode !== run.inputMode) {
    throw new Error(
      `Imported run "${run.runId}" has inputMode "${run.inputMode}" but lane "${run.laneId}" is configured for inputMode "${lane.inputMode}"`
    );
  }
  if (lane.inputMode === "raw" && run.spec !== null) {
    throw new Error(`Imported run "${run.runId}" is a raw-lane run but carries a non-null spec -- raw lanes must not receive specs.`);
  }
  if (lane.inputMode === "spec" && run.spec === null) {
    throw new Error(`Imported run "${run.runId}" is a spec-lane run but carries a null spec -- spec lanes must reference an approved spec bundle.`);
  }
  const model = experimentConfig.models[run.model.tier];
  if (!model) {
    throw new Error(`Imported run "${run.runId}" references unknown model tier "${run.model.tier}"`);
  }
  if (model.id !== run.model.id) {
    throw new Error(
      `Imported run "${run.runId}" has model.id "${run.model.id}" but model tier "${run.model.tier}" is configured for model.id "${model.id}"`
    );
  }
}

/**
 * Import execution metadata and evaluator evidence produced by an actual
 * (human- or tool-operated) benchmark run, and assemble/validate a
 * `contracts/run.schema.json`-compliant run artifact.
 *
 * This does not compute the quality score — that happens in `scoring.js`
 * from the evaluator JSON referenced by `evidence.evaluatorPath`. This step
 * only records the execution facts (what happened, how long it took, what
 * it cost) and where the evidence lives.
 *
 * Per correction item 8, this also (a) validates lane/inputMode/spec
 * presence and model tier/id consistency against the experiment config
 * (`validateImportedRunConsistency`, above), and (b) merges hash
 * provenance — evaluator file hash, costs config hash, and (if
 * `prepare.js`'s provenance.json is present in `runDir`) task-brief/spec/
 * scoring/experiment config hashes — plus the "frozen versions" actually
 * used (benchmarkVersion, baseline ref, pinned agent version, model
 * build id/effort params) into a supplementary, non-contract
 * `provenance.json` in `runDir`. This file is never validated against
 * `contracts/run.schema.json` (which has no room for it) and is not
 * referenced from `run.json`'s fixed `evidence` object, but sits alongside
 * `run.json` and `plan.json` in the same run directory for audit purposes.
 *
 * `execution.estimatedCostUsd` is only auto-computed (via `cost.js`'s
 * `computeCostUsd`, fed by `benchmark/config/costs.json`) when the caller
 * leaves it `null`/omitted — an explicit non-null value the caller
 * supplies (e.g. from an actual billing export) always wins. Per
 * correction item 6, a spec-lane run's auto-computed cost also folds in an
 * amortized share of the episode's approved spec authoring cost
 * (`amortizedSpecAuthoringShareUsd`, reading `authoringEffort` from the
 * spec bundle's `manifest.json` and dividing by `repetitionsPerLane`), so
 * the efficiency comparison reflects the one-time authoring investment
 * amortized across its reuse — not just this run's own execution cost.
 * Both stay `null` until `costs.json` carries dated, sourced per-model
 * pricing (per the "costs must remain null until dated pricing is
 * configured" requirement) — see `cost.js` for the exact provenance rules.
 */
export function importRun({
  runDir,
  benchmarkVersion = "unfrozen",
  dataKind = benchmarkVersion === "unfrozen" ? "illustrative" : "measured",
  freezeRecordSha256 = null,
  freezeRecordPath = null,
  baselineCommit,
  execution,
  source,
  evidence,
  experimentConfig = loadExperimentConfig(),
  costsConfig = loadCostsConfig(),
  repoRoot = REPO_ROOT
}) {
  const runRoot = path.resolve(runDir);
  if (!existsSync(runRoot)) {
    throw new Error(`Run directory does not exist: ${runRoot}`);
  }
  if (
    dataKind === "measured" &&
    (!lstatSync(runRoot).isDirectory() || lstatSync(runRoot).isSymbolicLink())
  ) {
    throw new Error("Measured run directory must be a real directory, not a link");
  }
  const planPath = path.join(runRoot, "plan.json");
  if (!existsSync(planPath)) {
    throw new Error(`No plan.json found in ${runRoot}; run "prepare" first.`);
  }
  if (dataKind === "measured") {
    assertRealPathInside(runRoot, planPath, "plan.json");
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const provenancePath = path.join(runRoot, "provenance.json");
  if (dataKind === "measured" && existsSync(provenancePath)) {
    assertRealPathInside(runRoot, provenancePath, "provenance.json");
  }
  const existingProvenance = existsSync(provenancePath)
    ? JSON.parse(readFileSync(provenancePath, "utf8"))
    : { schemaVersion: "1.1.0", runId: plan.runId, hashes: {} };
  const effectiveFreezeRecordSha256 =
    freezeRecordSha256 ?? existingProvenance.hashes?.freezeRecordSha256 ?? null;
  let measuredFreezeRecord = null;
  let workspaceDir = plan.workspaceDir;
  let promptPath = plan.promptPath;

  if (dataKind === "measured") {
    if (benchmarkVersion === "unfrozen") {
      throw new Error("Measured imports require a frozen benchmarkVersion");
    }
    if (!isSha256(plan.brief?.sha256)) {
      throw new Error("Measured imports require the prepared raw brief hash");
    }
    if (!isSha256(existingProvenance.hashes?.evaluatorSha256)) {
      throw new Error("Measured imports require the frozen evaluator hash");
    }
    if (!isSha256(existingProvenance.hashes?.scoringConfigSha256)) {
      throw new Error("Measured imports require the frozen scoring configuration hash");
    }
    if (!isSha256(effectiveFreezeRecordSha256)) {
      throw new Error("Measured imports require freezeRecordSha256");
    }
    assertFrozenMatch(existingProvenance.runId, plan.runId, "prepared run id");
    assertFrozenMatch(
      existingProvenance.hashes?.planSha256,
      hashFile(planPath),
      "prepared plan hash"
    );
    validateMeasuredPlan(plan, experimentConfig);
    const expectedWorkspaceDir = path.join(runRoot, "workspace");
    const expectedPromptPath = path.join(runRoot, "PROMPT.md");
    assertFrozenMatch(
      path.resolve(plan.workspaceDir ?? ""),
      expectedWorkspaceDir,
      "prepared workspace path"
    );
    assertFrozenMatch(
      path.resolve(plan.promptPath ?? ""),
      expectedPromptPath,
      "prepared prompt path"
    );
    workspaceDir = assertRealPathInside(
      runRoot,
      expectedWorkspaceDir,
      "prepared workspace"
    );
    promptPath = assertRealPathInside(runRoot, expectedPromptPath, "prepared prompt");
    measuredFreezeRecord = validateMeasuredFreeze({
      freezeRecordPath,
      freezeRecordSha256: effectiveFreezeRecordSha256,
      benchmarkVersion,
      plan,
      baselineCommit,
      execution,
      existingProvenance,
      repoRoot,
      runRoot
    }).freezeRecord;
    if (
      JSON.stringify(costsConfig) !==
      JSON.stringify(measuredFreezeRecord.frozenInputs?.costsConfig)
    ) {
      throw new Error("Measured imports require the costs configuration frozen in the readiness record");
    }
  }

  // Per correction item 6: auto-compute estimatedCostUsd from token usage
  // and costs.json unless the caller already supplied an explicit non-null
  // value. For spec-lane runs, fold in an amortized share of the episode's
  // approved spec authoring cost. Both remain null until costs.json carries
  // dated, sourced pricing -- see cost.js.
  let specAuthoringShareUsd = null;
  if (plan.inputMode === "spec") {
    const authoringEffort =
      dataKind === "measured"
        ? plan.spec?.authoringEffort
        : loadSpecAuthoringEffort(plan.episodeId, experimentConfig, repoRoot);
    specAuthoringShareUsd = amortizedSpecAuthoringShareUsd(authoringEffort, experimentConfig.repetitionsPerLane);
  }
  const computedCostUsd = computeCostUsd({
    modelId: plan.model.id,
    inputTokens: execution.inputTokens,
    outputTokens: execution.outputTokens,
    cachedInputTokens: execution.cachedInputTokens ?? 0,
    reasoningOutputTokens: execution.reasoningTokens ?? execution.reasoningOutputTokens ?? 0,
    costsConfig,
    specAuthoringShareUsd,
    requiresSpecAuthoringCost: plan.inputMode === "spec"
  });
  const estimatedCostUsd =
    dataKind === "measured"
      ? computedCostUsd
      : execution.estimatedCostUsd ?? computedCostUsd;
  const fallbackHash = (value) => createHash("sha256").update(String(value)).digest("hex");
  const promptHash =
    promptPath && existsSync(promptPath)
      ? hashFile(promptPath)
      : fallbackHash(promptPath ?? plan.runId);
  const evaluatorDirectory = path.join(repoRoot, "evaluator");
  if (dataKind === "measured") {
    resolveRunPath(evidence.directory, "evidence directory", {
      repoRoot,
      runRoot
    });
  }
  const evaluatorEvidencePath =
    dataKind === "measured"
      ? resolveRunPath(evidence.evaluatorPath, "evaluator evidence path", {
          repoRoot,
          runRoot
        })
      : path.isAbsolute(evidence.evaluatorPath)
        ? evidence.evaluatorPath
        : path.join(repoRoot, evidence.evaluatorPath);
  const transcriptPath =
    dataKind === "measured"
      ? resolveRunPath(evidence.transcriptPath, "transcript path", {
          repoRoot,
          runRoot
        })
      : path.isAbsolute(evidence.transcriptPath)
        ? evidence.transcriptPath
        : path.join(repoRoot, evidence.transcriptPath);
  const diffPath =
    dataKind === "measured"
      ? resolveRunPath(source.diffPath, "source diff path", {
          repoRoot,
          runRoot,
          forWrite: true
        })
      : path.isAbsolute(source.diffPath)
        ? source.diffPath
        : path.join(repoRoot, source.diffPath);
  const sourceBundleLogicalPath = source.bundlePath ?? `${source.diffPath}.bundle`;
  const sourceBundlePath =
    dataKind === "measured"
      ? resolveRunPath(sourceBundleLogicalPath, "source bundle path", {
          repoRoot,
          runRoot,
          forWrite: true
        })
      : path.isAbsolute(sourceBundleLogicalPath)
        ? sourceBundleLogicalPath
        : path.join(repoRoot, sourceBundleLogicalPath);
  if (dataKind === "measured") {
    if (!plan.workspaceDir || !plan.workspaceBaselineCommit) {
      throw new Error("Measured imports require an isolated Git workspace baseline");
    }
    const gitMetadataPath = path.join(workspaceDir, ".git");
    if (
      !existsSync(gitMetadataPath) ||
      !lstatSync(gitMetadataPath).isDirectory() ||
      lstatSync(gitMetadataPath).isSymbolicLink()
    ) {
      throw new Error("Measured source workspace must use evaluator-contained Git metadata");
    }
    assertRealPathInside(workspaceDir, gitMetadataPath, "workspace Git metadata");
    const gitTopLevel = realpathSync.native(
      execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: workspaceDir
      })
        .toString("utf8")
        .trim()
    );
    assertFrozenMatch(gitTopLevel, workspaceDir, "workspace Git root");
    const rootCommits = execFileSync(
      "git",
      ["rev-list", "--max-parents=0", "HEAD"],
      { cwd: workspaceDir }
    )
      .toString("utf8")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (
      rootCommits.length !== 1 ||
      rootCommits[0] !== plan.workspaceBaselineCommit
    ) {
      throw new Error("Measured source workspace baseline must be its single Git root commit");
    }
    assertFrozenMatch(
      hashGitRootAtRef(workspaceDir, plan.workspaceBaselineCommit),
      plan.baseline.sha256,
      "workspace baseline content hash"
    );
    const actualSourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: workspaceDir
    })
      .toString("utf8")
      .trim();
    assertFrozenMatch(source.commit, actualSourceCommit, "source commit");
    const dirtyWorkspace = execFileSync("git", ["status", "--porcelain"], {
      cwd: workspaceDir
    })
      .toString("utf8")
      .trim();
    if (dirtyWorkspace) {
      throw new Error("Measured source workspace must be clean with every candidate change committed");
    }
    const canonicalDiff = execFileSync(
      "git",
      [
        "diff",
        "--binary",
        "--no-ext-diff",
        `${plan.workspaceBaselineCommit}..${actualSourceCommit}`
      ],
      { cwd: workspaceDir }
    );
    mkdirSync(path.dirname(diffPath), { recursive: true });
    writeFileSync(diffPath, canonicalDiff);
    mkdirSync(path.dirname(sourceBundlePath), { recursive: true });
    execFileSync("git", ["bundle", "create", sourceBundlePath, "HEAD"], {
      cwd: workspaceDir
    });
  }
  const spec = plan.spec
    ? {
        id: plan.spec.id,
        sha256: plan.spec.sha256,
        qualityScore: plan.spec.qualityScore,
        authoringEffort: {
          elapsedSeconds: plan.spec.authoringEffort?.elapsedSeconds ?? 0,
          inputTokens: plan.spec.authoringEffort?.inputTokens ?? 0,
          cachedInputTokens: plan.spec.authoringEffort?.cachedInputTokens ?? 0,
          outputTokens: plan.spec.authoringEffort?.outputTokens ?? 0,
          reasoningTokens: plan.spec.authoringEffort?.reasoningTokens ?? 0,
          estimatedCostUsd: plan.spec.authoringEffort?.estimatedCostUsd ?? null,
          costEvidenceRef: plan.spec.authoringEffort?.costEvidenceRef ?? null,
          costMethod: plan.spec.authoringEffort?.costMethod ?? null,
          amortizedAcrossRuns:
            plan.spec.authoringEffort?.amortizedAcrossRuns ?? experimentConfig.repetitionsPerLane
        }
      }
    : null;
  const frozenInputs = {
    freezeRecordSha256: effectiveFreezeRecordSha256,
    evaluatorSha256:
      existingProvenance.hashes?.evaluatorSha256 ??
      (existsSync(evaluatorDirectory)
        ? hashDirectory(evaluatorDirectory)
        : fallbackHash("evaluator-unavailable")),
    scoringConfigSha256:
      existingProvenance.hashes?.scoringConfigSha256 ??
      hashFile(path.join(CONFIG_DIR, "scoring.json")) ??
      fallbackHash("scoring-config-unavailable"),
    costsConfigSha256:
      existingProvenance.hashes?.costsConfigSha256 ??
      hashFile(path.join(CONFIG_DIR, "costs.json")) ??
      fallbackHash("costs-config-unavailable"),
    benchmarkEngineSha256:
      measuredFreezeRecord?.frozenInputs?.benchmarkEngineSha256 ??
      existingProvenance.hashes?.benchmarkEngineSha256 ??
      hashDirectory(path.join(repoRoot, "benchmark", "src")),
    promptSha256:
      measuredFreezeRecord
        ? plan.inputMode === "spec"
          ? measuredFreezeRecord.promptsAndSpecs.find((entry) => entry.episodeId === plan.episodeId).specPromptSha256
          : measuredFreezeRecord.promptsAndSpecs.find((entry) => entry.episodeId === plan.episodeId).rawPromptSha256
        : plan.promptSha256 ?? promptHash,
    experimentConfigSha256:
      measuredFreezeRecord?.frozenInputs?.experimentConfigSha256 ??
      existingProvenance.hashes?.experimentConfigSha256 ??
      hashFile(path.join(CONFIG_DIR, "experiment.json")) ??
      fallbackHash("experiment-config-unavailable"),
    runSchemaSha256:
      measuredFreezeRecord?.frozenInputs?.runSchemaSha256 ??
      hashFile(path.join(CONTRACTS_DIR, "run.schema.json")) ??
      fallbackHash("run-schema-unavailable"),
    reportSchemaSha256:
      measuredFreezeRecord?.frozenInputs?.reportSchemaSha256 ??
      hashFile(path.join(CONTRACTS_DIR, "report.schema.json")) ??
      fallbackHash("report-schema-unavailable")
  };

  const run = {
    schemaVersion: "1.1.0",
    dataKind,
    runId: plan.runId,
    benchmarkVersion,
    episodeId: plan.episodeId,
    laneId: plan.laneId,
    model: {
      id: plan.model.id,
      displayName: plan.model.displayName,
      tier: plan.model.tier,
      buildId: plan.model.buildId ?? null
    },
    inputMode: plan.inputMode,
    repetition: plan.repetition,
    baseline: {
      ref: plan.baseline.ref,
      commit: baselineCommit,
      sha256: plan.baseline.sha256
    },
    brief: plan.brief ?? {
      path: "benchmark/prompts/unknown.md",
      sha256: existingProvenance.hashes?.taskBriefSha256 ?? promptHash
    },
    spec,
    frozenInputs,
    execution: {
      status: execution.status,
      order: execution.order ?? plan.executionOrder ?? 1,
      startedAt: execution.startedAt,
      endedAt: execution.endedAt,
      elapsedSeconds: execution.elapsedSeconds,
      productiveSeconds: execution.productiveSeconds ?? execution.productiveDurationSeconds ?? null,
      queueSeconds: execution.queueSeconds ?? execution.queueDurationSeconds ?? null,
      modelId: execution.modelId ?? null,
      modelBuildId: execution.modelBuildId ?? null,
      agentVersion: execution.agentVersion,
      agentBuildId: execution.agentBuildId ?? null,
      reasoningEffort:
        execution.reasoningEffort ?? plan.model.effortParams?.reasoningEffort ?? null,
      toolCalls: execution.toolCalls,
      inputTokens: execution.inputTokens ?? null,
      cachedInputTokens: execution.cachedInputTokens ?? null,
      outputTokens: execution.outputTokens ?? null,
      reasoningTokens: execution.reasoningTokens ?? execution.reasoningOutputTokens ?? null,
      estimatedCostUsd,
      specAuthoringCostUsd: specAuthoringShareUsd,
      firstGreenBuildSeconds: execution.firstGreenBuildSeconds ?? null,
      firstPassingSuiteSeconds: execution.firstPassingSuiteSeconds ?? null,
      reworkCount: execution.reworkCount ?? 0,
      scopeChurnFiles: execution.scopeChurnFiles ?? 0
    },
    source: {
      commit: source.commit ?? null,
      diffPath: source.diffPath,
      diffSha256: hashFile(diffPath),
      bundlePath: sourceBundleLogicalPath,
      bundleSha256: hashFile(sourceBundlePath)
    },
    evidence: {
      directory: evidence.directory,
      transcriptPath: evidence.transcriptPath,
      transcriptSha256: hashFile(transcriptPath),
      evaluatorPath: evidence.evaluatorPath,
      evaluatorSha256: hashFile(evaluatorEvidencePath)
    }
  };

  const schema = loadRunSchema();
  const { valid, errors } = validateAgainstSchema(schema, run);
  if (!valid) {
    throw new Error(`Imported run failed contracts/run.schema.json validation:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  }

  validateImportedRunConsistency(run, experimentConfig);

  const runJsonPath = path.join(runDir, "run.json");
  writeFileSync(runJsonPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");

  const provenance = {
    ...existingProvenance,
    schemaVersion: "1.1.0",
    importedAt: new Date().toISOString(),
    hashes: {
      ...existingProvenance.hashes,
      costsConfigSha256: hashFile(path.join(CONFIG_DIR, "costs.json")),
      ...frozenInputs
    },
    frozenVersions: {
      benchmarkVersion,
      baselineRef: plan.baseline.ref,
      pinnedAgentVersion: plan.model.agentVersion ?? null,
      pinnedAgentBuildId: plan.model.agentBuildId ?? null,
      modelBuildId: plan.model.buildId ?? null,
      modelEffortParams: plan.model.effortParams ?? null
    },
    freezeRecordPath: freezeRecordPath ?? existingProvenance.freezeRecordPath ?? null
  };
  writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, "utf8");

  return { run, runJsonPath, provenancePath };
}
