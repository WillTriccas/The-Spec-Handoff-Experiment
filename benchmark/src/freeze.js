import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  CONFIG_DIR,
  CONTRACTS_DIR,
  REPO_ROOT,
  getExperimentConfigPath,
  loadCostsConfig,
  loadExperimentConfig,
  loadScoringConfig
} from "./config.js";
import { hashDirectory, hashDirectoryAtRef, hashFile, hashText } from "./prepare.js";
import { assembleSpec, loadBundle, renderSpecMarkdown } from "../../spec-factory/src/bundle.js";
import { hashBundle } from "../../spec-factory/src/hashing.js";
import { validateBundle } from "../../spec-factory/src/validate.js";

const REQUIRED_APPROVALS = [
  "scenario",
  "specifications",
  "evaluator",
  "claimAdjudication"
];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function git(args, repoRoot) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  }).trim();
}

function resolveRef(ref, repoRoot) {
  try {
    return git(["rev-parse", "--verify", ref], repoRoot);
  } catch {
    return null;
  }
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function safeHashDirectory(directory) {
  return existsSync(directory) ? hashDirectory(directory) : null;
}

export function approvalBlockers(approvals) {
  const blockers = [];
  for (const area of REQUIRED_APPROVALS) {
    const approval = approvals?.[area];
    if (
      approval?.approved !== true ||
      typeof approval.reviewer !== "string" ||
      approval.reviewer.length === 0 ||
      typeof approval.approvedAt !== "string" ||
      approval.approvedAt.length === 0 ||
      typeof approval.evidenceRef !== "string" ||
      approval.evidenceRef.length === 0
    ) {
      blockers.push(`Independent ${area} approval is not recorded.`);
    }
  }
  return blockers;
}

function inspectApprovedSpec(episode, repoRoot, blockers) {
  const specDirectory = path.join(repoRoot, episode.specBundle);
  const manifestPath = path.join(specDirectory, "manifest.json");
  if (!existsSync(manifestPath)) {
    blockers.push(`Approved specification manifest is missing for ${episode.id}.`);
    return {
      specBundlePath: episode.specBundle,
      specManifestSha256: null,
      assembledSpecSha256: null,
      specQualityScore: null,
      specAuthoringEffort: null,
      renderedSpec: null
    };
  }

  try {
    const manifest = readJson(manifestPath);
    const bundle = loadBundle(specDirectory);
    const validation = validateBundle(bundle);
    if (validation.errors.length > 0 || validation.criticalBlocks.length > 0) {
      blockers.push(`Approved specification for ${episode.id} no longer passes spec-factory validation.`);
    }
    const assembledSpecSha256 = hashBundle(assembleSpec(bundle, { id: manifest.id }));
    if (!isSha256(manifest.sha256) || assembledSpecSha256 !== manifest.sha256) {
      blockers.push(`Approved specification content hash is invalid for ${episode.id}.`);
    }
    return {
      specBundlePath: episode.specBundle,
      specManifestSha256: hashFile(manifestPath),
      assembledSpecSha256,
      specQualityScore: manifest.qualityScore ?? null,
      specAuthoringEffort: manifest.authoringEffort ?? null,
      renderedSpec: renderSpecMarkdown(bundle, {
        id: manifest.id,
        title: episode.name
      })
    };
  } catch (error) {
    blockers.push(`Approved specification for ${episode.id} cannot be loaded: ${error.message}`);
    return {
      specBundlePath: episode.specBundle,
      specManifestSha256: hashFile(manifestPath),
      assembledSpecSha256: null,
      specQualityScore: null,
      specAuthoringEffort: null,
      renderedSpec: null
    };
  }
}

function inspectAuthoringEvidence(episode, spec, repoRoot, blockers) {
  const evidencePath = path.join(repoRoot, episode.authoringEvidence);
  if (!existsSync(evidencePath)) {
    blockers.push(`Specification-authoring evidence is missing for ${episode.id}.`);
    return {
      path: episode.authoringEvidence,
      sha256: null,
      status: "not-evaluated"
    };
  }

  try {
    const evidence = readJson(evidencePath);
    if (evidence.status !== "completed") {
      blockers.push(`Specification-authoring session for ${episode.id} is not completed.`);
    }
    if (evidence.model?.id !== "claude-opus-5" || evidence.model?.reasoningEffort !== "high") {
      blockers.push(`Specification-authoring model pin is invalid for ${episode.id}.`);
    }
    if (evidence.blindnessAttestation?.attested !== true) {
      blockers.push(`Specification-authoring blindness is not attested for ${episode.id}.`);
    }
    if (
      spec.assembledSpecSha256 &&
      evidence.approvedSpecification?.contentSha256 !== spec.assembledSpecSha256
    ) {
      blockers.push(`Authoring evidence and approved specification hash disagree for ${episode.id}.`);
    }
    return {
      path: episode.authoringEvidence,
      sha256: hashFile(evidencePath),
      status: evidence.status
    };
  } catch (error) {
    blockers.push(`Specification-authoring evidence for ${episode.id} cannot be loaded: ${error.message}`);
    return {
      path: episode.authoringEvidence,
      sha256: hashFile(evidencePath),
      status: "invalid"
    };
  }
}

export function createFreezeReadiness({
  repoRoot = REPO_ROOT,
  generatedAt = new Date().toISOString(),
  experimentConfig = loadExperimentConfig(),
  experimentConfigPath = getExperimentConfigPath(),
  scoringConfig = loadScoringConfig(),
  costsConfig = loadCostsConfig()
} = {}) {
  const blockers = [];
  const approvalsPath = path.resolve(
    repoRoot,
    experimentConfig.approvalsPath ?? "benchmark/config/approvals.json"
  );
  const approvals = existsSync(approvalsPath)
    ? readJson(approvalsPath)
    : { schemaVersion: "freeze-approvals/1.0.0" };
  const dirtyEntries = git(["status", "--porcelain"], repoRoot)
    .split(/\r?\n/)
    .filter(Boolean);

  if (dirtyEntries.length > 0) {
    blockers.push("Repository working tree is not clean.");
  }
  if (experimentConfig.status !== "not-evaluated") {
    blockers.push("Pre-measurement experiment status must remain not-evaluated.");
  }
  if (
    experimentConfig.authoring?.modelId !== "claude-opus-5" ||
    experimentConfig.authoring?.reasoningEffort !== "high" ||
    !experimentConfig.authoring?.agentVersion
  ) {
    blockers.push("Specification-authoring model, agent version, and high reasoning effort are not pinned.");
  }
  if (experimentConfig.repetitionsPerLane !== 3) {
    blockers.push("The experiment must pin exactly three repetitions per lane.");
  }
  if (
    experimentConfig.executionPolicy?.timeoutSeconds !== 7200 ||
    !Number.isInteger(experimentConfig.executionPolicy?.toolCallCap) ||
    experimentConfig.executionPolicy.toolCallCap <= 0
  ) {
    blockers.push("Execution timeout and tool-call cap are not pinned.");
  }
  if (
    experimentConfig.executionPolicy?.freshWorkspacePerRun !== true ||
    experimentConfig.executionPolicy?.freshConversationPerRun !== true ||
    experimentConfig.executionPolicy?.crossRunMemory !== false ||
    experimentConfig.executionPolicy?.humanRemediation !== false ||
    experimentConfig.executionPolicy?.selectiveRerunsAllowed !== false
  ) {
    blockers.push("Execution isolation and no-remediation policy is incomplete.");
  }

  const lanes = experimentConfig.lanes.map((lane) => lane.id).sort();
  if (JSON.stringify(lanes) !== JSON.stringify(["mai-spec", "opus-spec"])) {
    blockers.push("The frozen matrix must contain only opus-spec and mai-spec lanes.");
  }

  const baselines = experimentConfig.episodes.map((episode) => {
    const commit = resolveRef(episode.baselineRef, repoRoot);
    if (!commit) {
      blockers.push(`Baseline ref ${episode.baselineRef} does not resolve.`);
    }
    return {
      episodeId: episode.id,
      ref: episode.baselineRef,
      commit,
      path: episode.baselinePath,
      sha256: commit
        ? hashDirectoryAtRef(episode.baselineRef, episode.baselinePath, repoRoot)
        : null
    };
  });

  const promptsAndSpecs = experimentConfig.episodes.map((episode) => {
    const taskBriefPath = path.join(repoRoot, episode.taskBrief);
    const authoringPromptPath = path.join(repoRoot, episode.authoringPrompt);
    const authoringPlanPath = path.join(repoRoot, episode.authoringPlan);
    for (const [label, filePath] of [
      ["task brief", taskBriefPath],
      ["authoring prompt", authoringPromptPath],
      ["authoring plan", authoringPlanPath]
    ]) {
      if (!existsSync(filePath)) {
        blockers.push(`${episode.id} ${label} is missing.`);
      }
    }

    const spec = inspectApprovedSpec(episode, repoRoot, blockers);
    const authoringEvidence = inspectAuthoringEvidence(episode, spec, repoRoot, blockers);
    const briefText = existsSync(taskBriefPath) ? readFileSync(taskBriefPath, "utf8") : "";
    const specPromptSha256 = spec.renderedSpec
      ? hashText(`${briefText.trimEnd()}\n\n---\n\n# Approved specification\n\n${spec.renderedSpec}`)
      : null;
    const laneSpecSha256 = Object.fromEntries(
      experimentConfig.lanes.map((lane) => [lane.id, spec.assembledSpecSha256])
    );
    if (
      isSha256(laneSpecSha256["opus-spec"]) &&
      laneSpecSha256["opus-spec"] !== laneSpecSha256["mai-spec"]
    ) {
      blockers.push(`Implementation lanes do not share one specification hash for ${episode.id}.`);
    }

    return {
      episodeId: episode.id,
      taskBriefPath: episode.taskBrief,
      taskBriefSha256: hashFile(taskBriefPath),
      authoringPromptPath: episode.authoringPrompt,
      authoringPromptSha256: hashFile(authoringPromptPath),
      authoringPlanPath: episode.authoringPlan,
      authoringPlanSha256: hashFile(authoringPlanPath),
      authoringEvidence,
      specPromptSha256,
      ...spec,
      renderedSpec: undefined,
      laneSpecSha256
    };
  });

  blockers.push(...approvalBlockers(approvals));

  const models = Object.entries(experimentConfig.models).map(([tier, model]) => {
    if (!model.id || !model.buildId || !model.agentVersion || !model.agentBuildId) {
      blockers.push(`${tier} model and agent pins are incomplete.`);
    }
    if (model.effortParams?.reasoningEffort !== "high") {
      blockers.push(`${tier} reasoning effort must be high.`);
    }
    return {
      tier,
      id: model.id,
      displayName: model.displayName,
      buildId: model.buildId,
      agentVersion: model.agentVersion,
      agentBuildId: model.agentBuildId,
      effortParams: model.effortParams
    };
  });

  const readiness = {
    schemaVersion: "freeze-readiness/1.0.0",
    generatedAt,
    ready: blockers.length === 0,
    blockers,
    benchmarkVersion: experimentConfig.benchmarkVersion,
    status: "not-evaluated",
    evidenceQualification: experimentConfig.evidenceQualification,
    repository: {
      headCommit: git(["rev-parse", "HEAD"], repoRoot),
      clean: dirtyEntries.length === 0,
      dirtyEntries
    },
    baselines,
    promptsAndSpecs,
    frozenInputs: {
      evaluatorSha256: safeHashDirectory(path.join(repoRoot, "evaluator")),
      scoringConfigSha256: hashFile(path.join(CONFIG_DIR, "scoring.json")),
      experimentConfigSha256: hashFile(experimentConfigPath),
      costsConfigSha256: hashFile(path.join(CONFIG_DIR, "costs.json")),
      benchmarkEngineSha256: safeHashDirectory(path.join(repoRoot, "benchmark", "src")),
      authoringEvidenceSchemaSha256: hashFile(
        path.join(CONTRACTS_DIR, "specification-authoring-evidence.schema.json")
      ),
      runSchemaSha256: hashFile(path.join(CONTRACTS_DIR, "run.schema.json")),
      reportSchemaSha256: hashFile(path.join(CONTRACTS_DIR, "report.schema.json")),
      candidateAdapterSchemaSha256: hashFile(
        path.join(CONTRACTS_DIR, "candidate-adapter.schema.json")
      ),
      auditAdapterSchemaSha256: hashFile(
        path.join(CONTRACTS_DIR, "audit-adapter.schema.json")
      ),
      scoringConfig,
      costsConfig,
      claimRule: scoringConfig.claimRule
    },
    models,
    repetitionsPerLane: experimentConfig.repetitionsPerLane,
    executionPolicy: experimentConfig.executionPolicy,
    pricing: {
      pricingAsOf: costsConfig.pricingAsOf,
      source: costsConfig.source,
      rateType: costsConfig.rateType,
      monetaryClaimsEnabled: false
    },
    approvals
  };
  return {
    ...readiness,
    recordSha256: createHash("sha256")
      .update(JSON.stringify(readiness))
      .digest("hex")
  };
}

export function computeFreezeRecordSha256(record) {
  const unsignedRecord = { ...record };
  delete unsignedRecord.recordSha256;
  return createHash("sha256").update(JSON.stringify(unsignedRecord)).digest("hex");
}

export function assertUsableFreezeRecord(record, expectedSha256 = null) {
  const computedSha256 = computeFreezeRecordSha256(record);
  if (record.recordSha256 !== computedSha256) {
    throw new Error("Freeze record self-hash is invalid");
  }
  if (expectedSha256 !== null && record.recordSha256 !== expectedSha256) {
    throw new Error("Freeze record hash does not match the measured artifacts");
  }
  if (
    record.schemaVersion !== "freeze-readiness/1.0.0" ||
    record.ready !== true ||
    record.repository?.clean !== true ||
    !Array.isArray(record.blockers) ||
    record.blockers.length !== 0
  ) {
    throw new Error("Measured evidence requires a ready, clean freeze record with no blockers");
  }
  const storedApprovalBlockers = approvalBlockers(record.approvals);
  if (storedApprovalBlockers.length > 0) {
    throw new Error(
      `Measured evidence requires all independent freeze approvals: ${storedApprovalBlockers.join(" ")}`
    );
  }
  for (const entry of record.promptsAndSpecs ?? []) {
    const opusHash = entry.laneSpecSha256?.["opus-spec"];
    const maiHash = entry.laneSpecSha256?.["mai-spec"];
    if (!isSha256(opusHash) || opusHash !== maiHash || entry.assembledSpecSha256 !== opusHash) {
      throw new Error(`Measured evidence requires one identical approved specification for ${entry.episodeId}`);
    }
    if (entry.authoringEvidence?.status !== "completed") {
      throw new Error(`Measured evidence requires completed authoring evidence for ${entry.episodeId}`);
    }
  }
  return record;
}

export function writeFreezeReadiness(readiness, outputPath) {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(readiness, null, 2)}\n`, "utf8");
  return outputPath;
}
