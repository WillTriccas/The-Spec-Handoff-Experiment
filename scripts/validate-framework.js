import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  REPO_ROOT,
  loadExperimentConfig
} from "../benchmark/src/config.js";
import { createFreezeReadiness } from "../benchmark/src/freeze.js";
import {
  hashDirectoryAtRef
} from "../benchmark/src/prepare.js";
import {
  assignRandomizedOrder,
  buildPlannedRuns
} from "../benchmark/src/runs.js";

const readJson = (relativePath) =>
  JSON.parse(readFileSync(path.join(REPO_ROOT, relativePath), "utf8"));

const config = loadExperimentConfig();
assert.equal(config.status, "not-evaluated");
assert.deepEqual(
  config.lanes.map((lane) => lane.id).sort(),
  ["mai-spec", "opus-spec"]
);
assert.equal(config.repetitionsPerLane, 3);
assert.equal(config.executionPolicy.timeoutSeconds, 7200);
assert.equal(config.executionPolicy.selectiveRerunsAllowed, false);

const planned = assignRandomizedOrder(buildPlannedRuns(config))
  .sort((left, right) => left.executionOrder - right.executionOrder);
assert.equal(planned.length, 12);
assert.equal(new Set(planned.map((run) => run.runId)).size, 12);
assert.ok(
  planned.slice(1).every(
    (run, index) => run.episodeId !== planned[index].episodeId
  )
);
assert.ok(
  planned.slice(2).every(
    (run, index) =>
      !(run.laneId === planned[index + 1].laneId &&
        run.laneId === planned[index].laneId)
  )
);

const manifest = readJson(
  "evidence/test-runs/2026-08-21-v1.0.0/manifest.json"
);
assert.equal(manifest.status, "not-evaluated");
assert.deepEqual(
  manifest.plannedCells.map(({ runId, executionOrder }) => ({
    runId,
    executionOrder
  })),
  planned.map(({ runId, executionOrder }) => ({ runId, executionOrder }))
);
assert.ok(
  manifest.plannedCells.every((cell) => cell.status === "not-evaluated")
);

const status = readJson(
  "evidence/test-runs/2026-08-21-v1.0.0/reports/status.json"
);
for (const key of [
  "status",
  "quality",
  "implementationTokens",
  "endToEndTokens",
  "productiveTime",
  "queueAndThrottleTime"
]) {
  assert.equal(status[key], "not-evaluated");
}

const provenance = readJson("provenance/baselines.json");
assert.equal(
  provenance.sourceCommit,
  "05547458aeb09d651237fa521459d742e1d36e85"
);
for (const baseline of provenance.baselines) {
  const resolvedCommit = execFileSync(
    "git",
    ["rev-list", "-n", "1", baseline.tag],
    { cwd: REPO_ROOT, encoding: "utf8" }
  ).trim();
  assert.equal(resolvedCommit, baseline.commit);
  assert.equal(
    hashDirectoryAtRef(`refs/tags/${baseline.tag}`, baseline.path, REPO_ROOT),
    baseline.tagContentSha256
  );
  assert.equal(baseline.sourceContentSha256, baseline.tagContentSha256);
}

for (const contract of [
  "contracts/specification-authoring-evidence.schema.json",
  "contracts/run.schema.json",
  "contracts/report.schema.json",
  "contracts/candidate-adapter.schema.json",
  "contracts/audit-adapter.schema.json"
]) {
  readJson(contract);
}

const readiness = createFreezeReadiness();
assert.equal(readiness.ready, false);
assert.equal(readiness.status, "not-evaluated");
assert.ok(
  readiness.blockers.some((blocker) =>
    blocker.includes("Approved specification manifest")
  )
);
assert.ok(
  readiness.blockers.some((blocker) =>
    blocker.includes("Independent specifications approval")
  )
);

const trackedFiles = execFileSync("git", ["ls-files"], {
  cwd: REPO_ROOT,
  encoding: "utf8"
}).split(/\r?\n/).filter(Boolean);
assert.deepEqual(
  trackedFiles.filter(
    (file) =>
      /^src\/.*\/(bin|obj)\//.test(file) ||
      /^dashboard\/(dist|dist-single)\//.test(file) ||
      /(^|\/)node_modules\//.test(file)
  ),
  []
);

const cloneRoot = mkdtempSync(path.join(tmpdir(), "spec-handoff-clone-"));
try {
  execFileSync("git", ["clone", "--quiet", "--no-local", REPO_ROOT, cloneRoot]);
  for (const baseline of provenance.baselines) {
    assert.equal(
      execFileSync("git", ["rev-parse", `refs/tags/${baseline.tag}^{}`], {
        cwd: cloneRoot,
        encoding: "utf8"
      }).trim(),
      baseline.commit
    );
  }
} finally {
  rmSync(cloneRoot, { recursive: true, force: true });
}

console.log("Framework validation passed; measured freeze is correctly blocked.");
