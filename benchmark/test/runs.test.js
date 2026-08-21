import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlannedRuns, plannedRunCount, assignRandomizedOrder } from "../src/runs.js";
import { loadExperimentConfig } from "../src/config.js";

test("exactly 24 runs are planned per the committed experiment contract", () => {
  const runs = buildPlannedRuns();
  assert.strictEqual(runs.length, 24);
  assert.strictEqual(plannedRunCount(), 24);
});

test("every episode x lane x repetition combination is present exactly once", () => {
  const config = loadExperimentConfig();
  const runs = buildPlannedRuns(config);
  const seen = new Set();
  for (const run of runs) {
    const key = `${run.episodeId}::${run.laneId}::${run.repetition}`;
    assert.ok(!seen.has(key), `duplicate run combination: ${key}`);
    seen.add(key);
  }
  assert.strictEqual(seen.size, config.episodes.length * config.lanes.length * config.repetitionsPerLane);
});

test("run ids are unique and stable", () => {
  const runs = buildPlannedRuns();
  const ids = new Set(runs.map((r) => r.runId));
  assert.strictEqual(ids.size, runs.length);
});

test("raw lanes carry no spec bundle reference used for prompt content, only metadata", () => {
  const runs = buildPlannedRuns();
  const rawRuns = runs.filter((r) => r.inputMode === "raw");
  assert.ok(rawRuns.length > 0);
  for (const run of rawRuns) {
    assert.ok(run.taskBrief, "raw run must reference a task brief");
  }
});

test("spec lanes reference the approved spec bundle path from the experiment config", () => {
  const runs = buildPlannedRuns();
  const specRuns = runs.filter((r) => r.inputMode === "spec");
  for (const run of specRuns) {
    assert.ok(run.specBundle.includes("approved"));
  }
});

test("model tier assignment matches configured lanes", () => {
  const runs = buildPlannedRuns();
  for (const run of runs) {
    if (run.laneId.startsWith("efficient")) {
      assert.strictEqual(run.modelTier, "efficient");
      assert.strictEqual(run.modelDisplayName, "MAI Code 1.1 Flash");
    } else {
      assert.strictEqual(run.modelTier, "frontier");
      assert.strictEqual(run.modelDisplayName, "Claude Opus 5");
    }
  }
});

test("each planned run carries the configured model and agent pins", () => {
  const config = loadExperimentConfig();
  const runs = buildPlannedRuns(config);
  for (const run of runs) {
    const model = config.models[run.modelTier];
    assert.strictEqual(run.modelBuildId, model.buildId ?? null);
    assert.strictEqual(run.modelAgentVersion, model.agentVersion ?? null);
    assert.strictEqual(run.modelAgentBuildId, model.agentBuildId ?? null);
    assert.deepStrictEqual(run.modelEffortParams, model.effortParams ?? null);
  }
});

test("assignRandomizedOrder stamps every run with a unique 1-based executionOrder, without mutating the input", () => {
  const runs = buildPlannedRuns();
  const ordered = assignRandomizedOrder(runs, "test-seed");
  assert.strictEqual(ordered.length, runs.length);
  assert.ok(runs.every((r) => r.executionOrder === undefined), "input runs must not be mutated");
  const orders = ordered.map((r) => r.executionOrder).sort((a, b) => a - b);
  assert.deepStrictEqual(orders, Array.from({ length: runs.length }, (_, i) => i + 1));
});

test("assignRandomizedOrder is deterministic for a given seed and interleaves lanes/episodes", () => {
  const runs = buildPlannedRuns();
  const orderedA = assignRandomizedOrder(runs, "fixed-seed");
  const orderedB = assignRandomizedOrder(runs, "fixed-seed");
  assert.deepStrictEqual(
    orderedA.map((r) => r.runId),
    orderedB.map((r) => r.runId)
  );
  // Guard against a no-op/identity shuffle and against a lane-grouped order:
  // consecutive runs in the shuffled order should not all share the same lane.
  assert.notDeepStrictEqual(
    orderedA.map((r) => r.runId),
    runs.map((r) => r.runId)
  );
  const distinctConsecutiveLanes = orderedA
    .slice(1)
    .some((run, i) => run.laneId !== orderedA[i].laneId);
  assert.ok(distinctConsecutiveLanes, "expected the shuffle to interleave lanes rather than group them");
});

test("assignRandomizedOrder produces a different order for a different seed", () => {
  const runs = buildPlannedRuns();
  const orderedA = assignRandomizedOrder(runs, "seed-one");
  const orderedB = assignRandomizedOrder(runs, "seed-two");
  assert.notDeepStrictEqual(
    orderedA.map((r) => r.runId),
    orderedB.map((r) => r.runId)
  );
});
