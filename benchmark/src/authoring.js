import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { REPO_ROOT, loadExperimentConfig } from "./config.js";
import { hashDirectory, hashDirectoryAtRef, hashFile, materializeDirectoryAtRef } from "./prepare.js";

const FORBIDDEN_NAMES = new Set([
  "evaluator",
  "evidence",
  "run.schema.json",
  "report.schema.json",
  "scoring.json"
]);

export function listAuthoringWorkspaceViolations(workspaceDirectory) {
  const violations = [];
  function walk(directory, relative = "") {
    for (const entry of readdirSync(directory)) {
      const relativePath = relative ? `${relative}/${entry}` : entry;
      if (FORBIDDEN_NAMES.has(entry.toLowerCase())) {
        violations.push(relativePath);
      }
      const absolutePath = path.join(directory, entry);
      if (statSync(absolutePath).isDirectory()) {
        walk(absolutePath, relativePath);
      }
    }
  }
  walk(workspaceDirectory);
  return violations.sort();
}

export function prepareAuthoringWorkspace(
  episodeId,
  outputRoot,
  {
    repoRoot = REPO_ROOT,
    experimentConfig = loadExperimentConfig()
  } = {}
) {
  const episode = experimentConfig.episodes.find((entry) => entry.id === episodeId);
  if (!episode) {
    throw new Error(`Unknown authoring episode: ${episodeId}`);
  }
  if (!existsSync(outputRoot)) {
    mkdirSync(outputRoot, { recursive: true });
  }

  const workspaceDirectory = path.join(outputRoot, episode.id);
  const baselineDirectory = path.join(workspaceDirectory, "baseline");
  const specDirectory = path.join(workspaceDirectory, "specification");
  mkdirSync(baselineDirectory, { recursive: true });
  mkdirSync(specDirectory, { recursive: true });

  materializeDirectoryAtRef(
    episode.baselineRef,
    episode.baselinePath,
    baselineDirectory,
    repoRoot
  );
  cpSync(path.join(repoRoot, "spec-factory", "src", "templates"), specDirectory, {
    recursive: true
  });

  const promptText = readFileSync(path.join(repoRoot, episode.authoringPrompt), "utf8");
  writeFileSync(path.join(workspaceDirectory, "PROMPT.md"), promptText, "utf8");
  const workspaceManifest = {
    schemaVersion: "authoring-workspace/1.0.0",
    status: "not-evaluated",
    episodeId,
    baseline: {
      ref: episode.baselineRef,
      sha256: hashDirectoryAtRef(episode.baselineRef, episode.baselinePath, repoRoot)
    },
    prompt: {
      path: "PROMPT.md",
      sha256: hashFile(path.join(workspaceDirectory, "PROMPT.md"))
    },
    allowedInputs: [
      "PROMPT.md",
      "baseline/**",
      "specification/**",
      "workspace-manifest.json"
    ],
    forbiddenInputs: [
      "evaluator/**",
      "evidence/**",
      "benchmark/config/scoring.json",
      "contracts/run.schema.json",
      "contracts/report.schema.json",
      "prior authoring or implementation transcripts"
    ]
  };
  writeFileSync(
    path.join(workspaceDirectory, "workspace-manifest.json"),
    `${JSON.stringify(workspaceManifest, null, 2)}\n`,
    "utf8"
  );

  const violations = listAuthoringWorkspaceViolations(workspaceDirectory);
  if (violations.length > 0) {
    throw new Error(
      `Authoring workspace contains sealed or prior-evidence material: ${violations.join(", ")}`
    );
  }
  return {
    workspaceDirectory,
    workspaceSha256: hashDirectory(workspaceDirectory),
    manifest: workspaceManifest
  };
}
