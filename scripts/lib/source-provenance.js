import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { hashDirectoryAtRef } from "../../benchmark/src/prepare.js";

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

export function verifySourceTrees({
  sourceDirectory,
  sourceCommit,
  baselines
}) {
  const resolvedCommit = git(["rev-parse", `${sourceCommit}^{commit}`], sourceDirectory);
  assert.equal(
    resolvedCommit,
    sourceCommit,
    `Source checkout resolved ${sourceCommit} to unexpected commit ${resolvedCommit}`
  );

  return baselines.map((baseline) => {
    const actualSha256 = hashDirectoryAtRef(
      sourceCommit,
      baseline.path,
      sourceDirectory
    );
    assert.equal(
      actualSha256,
      baseline.sourceContentSha256,
      `Source content hash mismatch for ${baseline.episodeId}: expected ${baseline.sourceContentSha256}, received ${actualSha256}`
    );
    return {
      episodeId: baseline.episodeId,
      path: baseline.path,
      expectedSha256: baseline.sourceContentSha256,
      actualSha256
    };
  });
}

export function verifyRemoteSourceProvenance({
  provenancePath,
  workingDirectory = null
}) {
  const provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
  const temporaryRoot =
    workingDirectory ?? mkdtempSync(path.join(tmpdir(), "spec-handoff-source-"));
  const ownsTemporaryRoot = workingDirectory === null;
  try {
    git(
      [
        "clone",
        "--quiet",
        "--filter=blob:none",
        "--no-checkout",
        provenance.sourceRepository,
        temporaryRoot
      ],
      path.dirname(temporaryRoot)
    );
    git(["fetch", "--quiet", "origin", provenance.sourceCommit], temporaryRoot);
    return {
      sourceRepository: provenance.sourceRepository,
      sourceCommit: provenance.sourceCommit,
      baselines: verifySourceTrees({
        sourceDirectory: temporaryRoot,
        sourceCommit: provenance.sourceCommit,
        baselines: provenance.baselines
      })
    };
  } finally {
    if (ownsTemporaryRoot) {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
}
