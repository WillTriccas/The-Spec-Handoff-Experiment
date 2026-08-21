import { test } from "node:test";
import assert from "node:assert/strict";
import { median, aggregateLane, aggregateEpisode, groupByLane } from "../src/aggregate.js";

test("median of an odd-length array is the middle value", () => {
  assert.strictEqual(median([1, 3, 2]), 2);
});

test("median of an even-length array is the average of the two middle values", () => {
  assert.strictEqual(median([1, 2, 3, 4]), 2.5);
});

test("median of an empty array is null", () => {
  assert.strictEqual(median([]), null);
});

function makeRun(overrides = {}) {
  return {
    laneId: "efficient-spec",
    modelDisplayName: "MAI Code 1.1 Flash",
    inputMode: "spec",
    qualityScore: 90,
    hardGatesPassed: true,
    elapsedSeconds: 1000,
    estimatedCostUsd: null,
    ...overrides
  };
}

test("aggregateLane computes median/min/max quality and elapsed time", () => {
  const runs = [
    makeRun({ qualityScore: 80, elapsedSeconds: 900 }),
    makeRun({ qualityScore: 90, elapsedSeconds: 1000 }),
    makeRun({ qualityScore: 100, elapsedSeconds: 1100 })
  ];
  const summary = aggregateLane(runs);
  assert.strictEqual(summary.qualityMedian, 90);
  assert.strictEqual(summary.qualityMin, 80);
  assert.strictEqual(summary.qualityMax, 100);
  assert.strictEqual(summary.elapsedMedianSeconds, 1000);
  assert.strictEqual(summary.runCount, 3);
});

test("aggregateLane counts only runs that passed all hard gates", () => {
  const runs = [
    makeRun({ hardGatesPassed: true }),
    makeRun({ hardGatesPassed: false }),
    makeRun({ hardGatesPassed: true })
  ];
  const summary = aggregateLane(runs);
  assert.strictEqual(summary.hardGatePassCount, 2);
  assert.strictEqual(summary.runCount, 3);
});

test("aggregateLane costMedianUsd is null whenever any run has a null cost (the current, expected state)", () => {
  const runs = [
    makeRun({ estimatedCostUsd: 1.5 }),
    makeRun({ estimatedCostUsd: null }),
    makeRun({ estimatedCostUsd: 2.0 })
  ];
  const summary = aggregateLane(runs);
  assert.strictEqual(summary.costMedianUsd, null);
});

test("aggregateLane computes a real costMedianUsd only when every run in the lane has a non-null cost", () => {
  const runs = [
    makeRun({ estimatedCostUsd: 1.0 }),
    makeRun({ estimatedCostUsd: 2.0 }),
    makeRun({ estimatedCostUsd: 3.0 })
  ];
  const summary = aggregateLane(runs);
  assert.strictEqual(summary.costMedianUsd, 2.0);
});

test("aggregateLane includes amortized spec-authoring tokens in token efficiency", () => {
  const runs = [
    makeRun({
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 50,
      reasoningTokens: 0,
      specAuthoringAmortizedTokens: 30
    })
  ];
  assert.strictEqual(aggregateLane(runs).tokenMedian, 180);
});

test("aggregateLane throws on an empty run list", () => {
  assert.throws(() => aggregateLane([]), /empty/);
});

test("groupByLane groups runs by laneId", () => {
  const runs = [
    makeRun({ laneId: "efficient-spec" }),
    makeRun({ laneId: "frontier-raw" }),
    makeRun({ laneId: "efficient-spec" })
  ];
  const grouped = groupByLane(runs);
  assert.strictEqual(grouped.size, 2);
  assert.strictEqual(grouped.get("efficient-spec").length, 2);
  assert.strictEqual(grouped.get("frontier-raw").length, 1);
});

test("aggregateEpisode produces one summary per distinct lane present in the runs", () => {
  const runs = [
    makeRun({ laneId: "efficient-spec" }),
    makeRun({ laneId: "efficient-spec" }),
    makeRun({ laneId: "frontier-raw" })
  ];
  const summaries = aggregateEpisode(runs);
  assert.strictEqual(summaries.length, 2);
  const laneIds = summaries.map((s) => s.laneId).sort();
  assert.deepStrictEqual(laneIds, ["efficient-spec", "frontier-raw"]);
});
