import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { hashDirectoryAtRef } from "../../benchmark/src/prepare.js";
import { verifySourceTrees } from "../lib/source-provenance.js";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function createSourceRepository() {
  const directory = mkdtempSync(path.join(tmpdir(), "source-provenance-test-"));
  git(["init", "--quiet"], directory);
  git(["config", "core.autocrlf", "false"], directory);
  git(["config", "user.name", "Provenance Test"], directory);
  git(["config", "user.email", "provenance@example.invalid"], directory);
  const workload = path.join(directory, "src", "workload");
  mkdirSync(workload, { recursive: true });
  writeFileSync(path.join(workload, "a.txt"), "alpha\n", "utf8");
  writeFileSync(path.join(workload, "b.txt"), "beta\n", "utf8");
  git(["add", "--all"], directory);
  git(["commit", "--quiet", "-m", "fixture"], directory);
  const commit = git(["rev-parse", "HEAD"], directory);
  const sha256 = hashDirectoryAtRef(commit, "src/workload", directory);
  return { directory, commit, sha256 };
}

test("source provenance independently hashes tracked files at the pinned commit", () => {
  const source = createSourceRepository();
  try {
    const result = verifySourceTrees({
      sourceDirectory: source.directory,
      sourceCommit: source.commit,
      baselines: [
        {
          episodeId: "fixture",
          path: "src/workload",
          sourceContentSha256: source.sha256
        }
      ]
    });
    assert.equal(result[0].actualSha256, source.sha256);
  } finally {
    rmSync(source.directory, { recursive: true, force: true });
  }
});

test("source provenance fails closed when a committed expected hash is wrong", () => {
  const source = createSourceRepository();
  try {
    assert.throws(
      () =>
        verifySourceTrees({
          sourceDirectory: source.directory,
          sourceCommit: source.commit,
          baselines: [
            {
              episodeId: "fixture",
              path: "src/workload",
              sourceContentSha256: "0".repeat(64)
            }
          ]
        }),
      /Source content hash mismatch/
    );
  } finally {
    rmSync(source.directory, { recursive: true, force: true });
  }
});
