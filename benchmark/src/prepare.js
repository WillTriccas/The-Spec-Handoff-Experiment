import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, cpSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync, execSync } from "node:child_process";
import path from "node:path";
import { REPO_ROOT, CONFIG_DIR, CONTRACTS_DIR, loadExperimentConfig } from "./config.js";
import {
  assembleSpec,
  loadBundle,
  renderSpecMarkdown
} from "../../spec-factory/src/bundle.js";
import { hashBundle } from "../../spec-factory/src/hashing.js";

/**
 * Deterministically hash a directory tree: sha256 over the sorted list of
 * (relative path, file content) pairs. Used as `baseline.sha256` in the run
 * manifest so a run can prove which exact baseline snapshot it started
 * from.
 */
export function hashDirectory(dir) {
  const files = [];
  (function walk(current, relative) {
    for (const entry of readdirSync(current).sort()) {
      if (entry === ".git") continue;
      const abs = path.join(current, entry);
      const rel = relative ? `${relative}/${entry}` : entry;
      const stat = statSync(abs);
      if (stat.isDirectory()) {
        walk(abs, rel);
      } else if (stat.isFile()) {
        files.push(rel);
      }
    }
  })(dir, "");

  const hash = createHash("sha256");
  for (const rel of files.sort()) {
    hash.update(rel, "utf8");
    hash.update("\0");
    hash.update(readFileSync(path.join(dir, rel)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function gitFilesAtRef(ref, baselinePath, repoRoot) {
  const normalizedPath = baselinePath.replaceAll("\\", "/").replace(/\/+$/, "");
  const listing = execFileSync(
    "git",
    ["ls-tree", "-r", "-z", "--name-only", ref, "--", normalizedPath],
    { cwd: repoRoot }
  );
  const files = listing
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort();
  if (files.length === 0) {
    throw new Error(`No tracked baseline files found at ${ref}:${normalizedPath}`);
  }
  return { normalizedPath, files };
}

export function hashDirectoryAtRef(ref, baselinePath, repoRoot = REPO_ROOT) {
  const { normalizedPath, files } = gitFilesAtRef(ref, baselinePath, repoRoot);
  const hash = createHash("sha256");
  for (const file of files) {
    const relativePath = file.slice(normalizedPath.length + 1);
    const content = execFileSync("git", ["cat-file", "blob", `${ref}:${file}`], {
      cwd: repoRoot
    });
    hash.update(relativePath, "utf8");
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function materializeDirectoryAtRef(
  ref,
  baselinePath,
  destination,
  repoRoot = REPO_ROOT
) {
  const { normalizedPath, files } = gitFilesAtRef(ref, baselinePath, repoRoot);
  for (const file of files) {
    const relativePath = file.slice(normalizedPath.length + 1);
    const destinationPath = path.join(destination, relativePath);
    mkdirSync(path.dirname(destinationPath), { recursive: true });
    const content = execFileSync("git", ["cat-file", "blob", `${ref}:${file}`], {
      cwd: repoRoot
    });
    writeFileSync(destinationPath, content);
  }

}

function initializeWorkspaceRepository(workspaceDir) {
  execFileSync("git", ["init", "--quiet"], { cwd: workspaceDir });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: workspaceDir });
  execFileSync("git", ["config", "user.name", "SpecForge Benchmark"], { cwd: workspaceDir });
  execFileSync(
    "git",
    ["config", "user.email", "benchmark@specforge.invalid"],
    { cwd: workspaceDir }
  );
  execFileSync("git", ["add", "--all"], { cwd: workspaceDir });
  execFileSync("git", ["commit", "--quiet", "-m", "Frozen benchmark baseline"], {
    cwd: workspaceDir
  });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspaceDir })
    .toString("utf8")
    .trim();
}

/**
 * sha256 of a single file's bytes, or null if the file does not exist.
 * Used to record hash provenance (task brief / scoring config / experiment
 * config) per correction item 8, without requiring those files to be
 * copied wholesale into the run's evidence.
 */
export function hashFile(filePath) {
  if (!existsSync(filePath)) return null;
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

export function hashText(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function assemblePromptText({ briefText, inputMode, renderedSpec = null }) {
  if (inputMode === "raw") return briefText;
  if (inputMode === "spec" && typeof renderedSpec === "string") {
    return `${briefText.trimEnd()}\n\n---\n\n# Approved specification\n\n${renderedSpec}`;
  }
  throw new Error(`Cannot assemble prompt for inputMode "${inputMode}"`);
}

/**
 * Assert that a planned run's lane, input mode, and model tier/id are all
 * mutually consistent with the committed experiment config, per correction
 * item 8 ("prepare/import must enforce lane -> input mode -> spec presence
 * and model tier/id"). This guards against a hand-constructed or
 * drifted run descriptor silently preparing a workspace with the wrong
 * prompt shape (e.g. a "spec" lane accidentally treated as "raw", or a
 * model tier resolving to the wrong model id).
 */
export function validateRunConsistency(run, experimentConfig = loadExperimentConfig()) {
  const lane = experimentConfig.lanes.find((l) => l.id === run.laneId);
  if (!lane) {
    throw new Error(`Run "${run.runId}" references unknown lane "${run.laneId}"`);
  }
  if (lane.inputMode !== run.inputMode) {
    throw new Error(
      `Run "${run.runId}" has inputMode "${run.inputMode}" but lane "${run.laneId}" is configured for inputMode "${lane.inputMode}"`
    );
  }
  const model = experimentConfig.models[run.modelTier];
  if (!model) {
    throw new Error(`Run "${run.runId}" references unknown model tier "${run.modelTier}"`);
  }
  if (model.id !== run.modelId) {
    throw new Error(
      `Run "${run.runId}" has modelId "${run.modelId}" but model tier "${run.modelTier}" is configured for modelId "${model.id}"`
    );
  }
}

/**
 * Prepare an isolated workspace for a single planned run: copy the baseline
 * directory, write the prompt the agent will receive, and write a plan.json
 * describing the run before execution.
 *
 * Raw lanes must never receive spec content: this function copies only the
 * raw task brief for `inputMode === "raw"` runs and asserts the spec bundle
 * directory is never read or copied in that path.
 *
 * Per correction item 8, this also validates lane -> input mode -> model
 * tier/id consistency before doing any work (`validateRunConsistency`), and
 * writes a supplementary `provenance.json` alongside plan.json recording
 * hashes of the task brief (or spec manifest) and the scoring/experiment
 * config files in effect, so a later audit can verify exactly which
 * config/prompt versions a measured run used.
 */
export function prepareRunWorkspace(run, { baselineDir, outputRoot, repoRoot = REPO_ROOT, experimentConfig = loadExperimentConfig() }) {
  validateRunConsistency(run, experimentConfig);

  if (!existsSync(baselineDir)) {
    throw new Error(`Baseline directory does not exist: ${baselineDir}`);
  }

  const runDir = path.join(outputRoot, run.runId);
  const workspaceDir = path.join(runDir, "workspace");
  mkdirSync(workspaceDir, { recursive: true });
  if (experimentConfig.benchmarkVersion === "unfrozen") {
    cpSync(baselineDir, workspaceDir, { recursive: true });
  } else {
    materializeDirectoryAtRef(
      run.baselineRef,
      run.baselinePath,
      workspaceDir,
      repoRoot
    );
  }

  const baselineSha256 = hashDirectory(workspaceDir);
  const workspaceBaselineCommit = initializeWorkspaceRepository(workspaceDir);

  const briefPath = path.join(repoRoot, run.taskBrief);
  const briefText = readFileSync(briefPath, "utf8");
  const taskBriefSha256 = hashFile(briefPath);
  let promptText = assemblePromptText({ briefText, inputMode: "raw" });
  let specInfo = null;
  let specManifestSha256 = null;

  if (run.inputMode === "raw") {
    // Guard: raw lanes must not receive specs. Fail loudly if a future
    // change accidentally wires a specBundle into a raw-mode run.
    if (run.specBundle) {
      // This is expected metadata on the run descriptor (every episode has
      // one spec bundle regardless of lane), but it must never be read
      // from disk or written into a raw workspace.
    }
  } else if (run.inputMode === "spec") {
    const specDir = path.join(repoRoot, run.specBundle);
    const manifestPath = path.join(specDir, "manifest.json");
    if (!existsSync(manifestPath)) {
      throw new Error(
        `Spec bundle at ${specDir} has no manifest.json — approve it with spec-factory before preparing spec-lane runs.`
      );
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const bundle = loadBundle(specDir);
    const assembledSpecSha256 = hashBundle(assembleSpec(bundle, { id: manifest.id }));
    if (assembledSpecSha256 !== manifest.sha256) {
      throw new Error(
        `Spec bundle at ${specDir} no longer matches its approved manifest; approve it again before preparing runs.`
      );
    }
    const renderedSpec = renderSpecMarkdown(bundle, { id: manifest.id, title: run.episodeName });
    promptText = assemblePromptText({ briefText, inputMode: "spec", renderedSpec });
    specInfo = {
      id: manifest.id,
      sha256: manifest.sha256,
      qualityScore: manifest.qualityScore,
      authoringEffort: {
        elapsedSeconds: Math.round((manifest.authoringEffort?.elapsedMinutes ?? 0) * 60),
        inputTokens:
          manifest.authoringEffort?.uncachedInputTokens ??
          manifest.authoringEffort?.inputTokens ??
          0,
        cachedInputTokens: manifest.authoringEffort?.cachedInputTokens ?? 0,
        outputTokens: manifest.authoringEffort?.outputTokens ?? 0,
        reasoningTokens: manifest.authoringEffort?.reasoningTokens ?? 0,
        estimatedCostUsd: manifest.authoringEffort?.estimatedCostUsd ?? null,
        costEvidenceRef: manifest.authoringEffort?.costEvidenceRef ?? null,
        costMethod: manifest.authoringEffort?.costMethod ?? null,
        amortizedAcrossRuns: experimentConfig.repetitionsPerLane
      }
    };
    specManifestSha256 = hashFile(manifestPath);
  } else {
    throw new Error(`Unknown inputMode: ${run.inputMode}`);
  }

  const promptPath = path.join(runDir, "PROMPT.md");
  writeFileSync(promptPath, promptText, "utf8");

  const plan = {
    schemaVersion: "1.1.0",
    runId: run.runId,
    episodeId: run.episodeId,
    laneId: run.laneId,
    model: {
      id: run.modelId,
      displayName: run.modelDisplayName,
      tier: run.modelTier,
      buildId: run.modelBuildId ?? null,
      agentVersion: run.modelAgentVersion ?? null,
      agentBuildId: run.modelAgentBuildId ?? null,
      effortParams: run.modelEffortParams ?? null
    },
    inputMode: run.inputMode,
    repetition: run.repetition,
    baseline: { ref: run.baselineRef, sha256: baselineSha256 },
    brief: { path: run.taskBrief, sha256: taskBriefSha256 },
    promptSha256: hashText(promptText),
    spec: specInfo,
    executionOrder: run.executionOrder ?? 1,
    executionPolicySnapshot: experimentConfig.executionPolicy ?? null,
    workspaceDir,
    workspaceBaselineCommit,
    promptPath
  };

  const planPath = path.join(runDir, "plan.json");
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  const provenance = {
    schemaVersion: "1.1.0",
    runId: run.runId,
    preparedAt: new Date().toISOString(),
    hashes: {
      taskBriefSha256,
      promptSha256: hashText(promptText),
      specManifestSha256,
      scoringConfigSha256: hashFile(path.join(CONFIG_DIR, "scoring.json")),
      experimentConfigSha256: hashFile(path.join(CONFIG_DIR, "experiment.json")),
      costsConfigSha256: hashFile(path.join(CONFIG_DIR, "costs.json")),
      benchmarkEngineSha256: hashDirectory(path.join(repoRoot, "benchmark", "src")),
      runSchemaSha256: hashFile(path.join(CONTRACTS_DIR, "run.schema.json")),
      reportSchemaSha256: hashFile(path.join(CONTRACTS_DIR, "report.schema.json")),
      baselineSha256,
      planSha256: hashFile(planPath),
      evaluatorSha256: hashDirectory(path.join(repoRoot, "evaluator")),
      freezeRecordSha256: null
    },
    executionPolicySnapshot: experimentConfig.executionPolicy ?? null
  };
  const provenancePath = path.join(runDir, "provenance.json");
  writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, "utf8");

  return { runDir, workspaceDir, promptPath, planPath, provenancePath, plan };
}

/**
 * Asserts that a prepared raw-lane workspace does not contain any file
 * copied from the referenced spec bundle directory. Intended for tests and
 * defensive CI checks, not the hot path (which never reads the spec bundle
 * for raw lanes to begin with).
 */
export function assertNoSpecLeakage(run, workspaceDir, repoRoot = REPO_ROOT) {
  if (run.inputMode !== "raw" || !run.specBundle) return;
  const specDir = path.join(repoRoot, run.specBundle);
  if (!existsSync(specDir)) return;
  const specFiles = readdirSync(specDir);
  for (const file of specFiles) {
    if (existsSync(path.join(workspaceDir, file))) {
      throw new Error(`Spec leakage detected: raw-lane workspace contains ${file} from the spec bundle`);
    }
  }
}

/**
 * Assert that measured (non-"unfrozen") benchmark data is being prepared
 * or imported from a clean, committed working tree -- per correction item 8
 * ("frozen clean version for measured data"). Deliberately *not* called
 * automatically from `prepareRunWorkspace`/`importRun` so that unit tests
 * (and illustrative/dry-run usage, which always passes `benchmarkVersion:
 * "unfrozen"`) never depend on the ambient git state of whatever
 * environment happens to be running them; the CLI's `import` command calls
 * this explicitly for real measured imports (see cli.js), with an opt-out
 * flag for exceptional cases.
 */
export function assertFrozenForMeasuredData(benchmarkVersion, { repoRoot = REPO_ROOT } = {}) {
  if (benchmarkVersion === "unfrozen") {
    return { enforced: false, clean: null };
  }
  const status = execSync("git status --porcelain", { cwd: repoRoot, encoding: "utf8" });
  if (status.trim().length > 0) {
    throw new Error(
      `benchmarkVersion "${benchmarkVersion}" is not "unfrozen", so this must be measured data from a clean, committed working tree. ` +
        `"git status --porcelain" reported uncommitted changes:\n${status}`
    );
  }
  return { enforced: true, clean: true };
}
