import { test } from "node:test";
import assert from "node:assert/strict";
import { determineClaim, weakestStatus } from "../src/claim.js";

const claimRule = {
  comparisonLane: "efficient-spec",
  controlLane: "frontier-raw",
  equivalentWithinPoints: 3,
  betterByMoreThanPoints: 3,
  requireAllHardGates: true,
  requireLowerMedianCostOrElapsedTimeForEfficiency: true
};

function run(laneId, overrides = {}) {
  return {
    laneId,
    modelDisplayName: "x",
    inputMode: laneId.endsWith("spec") ? "spec" : "raw",
    qualityScore: 90,
    hardGatesPassed: true,
    elapsedSeconds: 1000,
    estimatedCostUsd: null,
    inputTokens: 100,
    cachedInputTokens: 0,
    outputTokens: 50,
    reasoningOutputTokens: 0,
    ...overrides
  };
}

test("illustrative data always yields not-evaluated regardless of how favorable the numbers look", () => {
  const runs = [
    run("efficient-spec", { qualityScore: 100, elapsedSeconds: 1 }),
    run("frontier-raw", { qualityScore: 1, elapsedSeconds: 100000 })
  ];
  const claim = determineClaim(runs, { claimRule, dataKind: "illustrative" });
  assert.strictEqual(claim.status, "not-evaluated");
  assert.strictEqual(claim.qualityDelta, null);
  assert.match(claim.message, /illustrative/i);
});

test("not-evaluated when one of the two lanes has no runs at all", () => {
  const runs = [run("efficient-spec"), run("efficient-spec")];
  const claim = determineClaim(runs, { claimRule, dataKind: "measured" });
  assert.strictEqual(claim.status, "not-evaluated");
});

test("not-supported when a hard gate fails in the comparison lane", () => {
  const runs = [
    run("efficient-spec", { hardGatesPassed: false }),
    run("efficient-spec", { hardGatesPassed: true }),
    run("frontier-raw", { hardGatesPassed: true }),
    run("frontier-raw", { hardGatesPassed: true })
  ];
  const claim = determineClaim(runs, { claimRule, dataKind: "measured" });
  assert.strictEqual(claim.status, "not-supported");
});

test("not-supported when comparison quality is meaningfully worse than control", () => {
  const runs = [
    run("efficient-spec", { qualityScore: 70, elapsedSeconds: 500 }),
    run("frontier-raw", { qualityScore: 90, elapsedSeconds: 1000 })
  ];
  const claim = determineClaim(runs, { claimRule, dataKind: "measured" });
  assert.strictEqual(claim.status, "not-supported");
  assert.strictEqual(claim.qualityDelta, -20);
});

test("inconclusive when quality is non-inferior but no cost/time efficiency is demonstrated", () => {
  const runs = [
    run("efficient-spec", { qualityScore: 90, elapsedSeconds: 1200, estimatedCostUsd: null }),
    run("frontier-raw", { qualityScore: 90, elapsedSeconds: 1000, estimatedCostUsd: null })
  ];
  const claim = determineClaim(runs, { claimRule, dataKind: "measured" });
  assert.strictEqual(claim.status, "inconclusive");
});

test("supported (non-inferior to) when quality is within margin and token use is lower", () => {
  const runs = [
    run("efficient-spec", { qualityScore: 89, inputTokens: 50 }),
    run("frontier-raw", { qualityScore: 90, inputTokens: 500 })
  ];
  const claim = determineClaim(runs, { claimRule, dataKind: "measured" });
  assert.strictEqual(claim.status, "supported");
  assert.match(claim.message, /non-inferior to/);
  assert.match(claim.message, /median total token consumption/);
  assert.doesNotMatch(claim.message, /elapsed-time-only/);
});

test("supported (better than) when comparison quality clearly exceeds control and cost is lower", () => {
  const runs = [
    run("efficient-spec", { qualityScore: 95, elapsedSeconds: 800, estimatedCostUsd: 1.0 }),
    run("frontier-raw", { qualityScore: 85, elapsedSeconds: 1000, estimatedCostUsd: 5.0 })
  ];
  const claim = determineClaim(runs, { claimRule, dataKind: "measured" });
  assert.strictEqual(claim.status, "supported");
  assert.match(claim.message, /better than/);
  assert.strictEqual(claim.qualityDelta, 10);
  assert.ok(claim.costSavingPercent > 0);
});

test("costSavingPercent is null unless both lanes have non-null median costs", () => {
  const runs = [
    run("efficient-spec", { qualityScore: 92, elapsedSeconds: 800, estimatedCostUsd: null }),
    run("frontier-raw", { qualityScore: 90, elapsedSeconds: 1000, estimatedCostUsd: 5.0 })
  ];
  const claim = determineClaim(runs, { claimRule, dataKind: "measured" });
  assert.strictEqual(claim.costSavingPercent, null);
});

test("a quality delta within the observed within-lane spread is indeterminate, not better/worse", () => {
  const runs = [
    run("efficient-spec", { episodeId: "modernization", qualityScore: 80 }),
    run("efficient-spec", { episodeId: "modernization", qualityScore: 95 }),
    run("frontier-raw", { episodeId: "modernization", qualityScore: 88 }),
    run("frontier-raw", { episodeId: "modernization", qualityScore: 90 })
  ];
  const claim = determineClaim(runs, { claimRule, dataKind: "measured" });
  assert.strictEqual(claim.status, "inconclusive");
  assert.strictEqual(claim.episodeClaims[0].qualityVerdict, "indeterminate");
  assert.match(claim.episodeClaims[0].message, /within-lane spread/);
});

test("a quality delta clearly larger than the observed spread is not marked indeterminate", () => {
  const runs = [
    run("efficient-spec", { episodeId: "modernization", qualityScore: 94 }),
    run("efficient-spec", { episodeId: "modernization", qualityScore: 96 }),
    run("frontier-raw", { episodeId: "modernization", qualityScore: 60 }),
    run("frontier-raw", { episodeId: "modernization", qualityScore: 62 })
  ];
  const claim = determineClaim(runs, { claimRule, dataKind: "measured" });
  assert.notStrictEqual(claim.episodeClaims[0].qualityVerdict, "indeterminate");
  assert.strictEqual(claim.episodeClaims[0].qualityVerdict, "better");
});

test("overall status across two episodes is the weaker of the two, never an average", () => {
  const runs = [
    // modernization: clearly supported
    run("efficient-spec", { episodeId: "modernization", qualityScore: 95, estimatedCostUsd: 1 }),
    run("frontier-raw", { episodeId: "modernization", qualityScore: 85, estimatedCostUsd: 5 }),
    // audit-feature: clearly not-supported (quality far worse)
    run("efficient-spec", { episodeId: "audit-feature", qualityScore: 50 }),
    run("frontier-raw", { episodeId: "audit-feature", qualityScore: 90 })
  ];
  const claim = determineClaim(runs, { claimRule, dataKind: "measured" });
  assert.strictEqual(claim.status, "not-supported");
  assert.strictEqual(claim.episodeClaims.length, 2);
  const statuses = claim.episodeClaims.map((c) => c.status).sort();
  assert.deepStrictEqual(statuses, ["not-supported", "supported"]);
});

test("headline episode tie-breaking follows the registered episode order, not run order", () => {
  const runs = [
    run("efficient-spec", { episodeId: "audit-feature", qualityScore: 94, estimatedCostUsd: 1 }),
    run("frontier-raw", { episodeId: "audit-feature", qualityScore: 90, estimatedCostUsd: 3 }),
    run("efficient-spec", { episodeId: "modernization", qualityScore: 100, estimatedCostUsd: 1 }),
    run("frontier-raw", { episodeId: "modernization", qualityScore: 90, estimatedCostUsd: 5 })
  ];
  const options = {
    claimRule,
    dataKind: "measured",
    episodeOrder: ["modernization", "audit-feature"]
  };
  const forward = determineClaim(runs, options);
  const reversed = determineClaim([...runs].reverse(), options);
  assert.strictEqual(forward.qualityDelta, 10);
  assert.strictEqual(reversed.qualityDelta, 10);
  assert.match(forward.message, /Driving episode.*modernization/);
  assert.match(reversed.message, /Driving episode.*modernization/);
});

test("worse is defined as strictly below the -equivalentWithinPoints margin, not merely outside a symmetric band", () => {
  // Exactly at -3 (the margin) should NOT be "worse" -- only strictly below -3 is worse.
  const atMargin = [
    run("efficient-spec", { episodeId: "modernization", qualityScore: 87 }),
    run("efficient-spec", { episodeId: "modernization", qualityScore: 87 }),
    run("frontier-raw", { episodeId: "modernization", qualityScore: 90 }),
    run("frontier-raw", { episodeId: "modernization", qualityScore: 90 })
  ];
  const claimAtMargin = determineClaim(atMargin, { claimRule, dataKind: "measured" });
  assert.notStrictEqual(claimAtMargin.episodeClaims[0].qualityVerdict, "worse");

  const belowMargin = [
    run("efficient-spec", { episodeId: "modernization", qualityScore: 86 }),
    run("efficient-spec", { episodeId: "modernization", qualityScore: 86 }),
    run("frontier-raw", { episodeId: "modernization", qualityScore: 90 }),
    run("frontier-raw", { episodeId: "modernization", qualityScore: 90 })
  ];
  const claimBelowMargin = determineClaim(belowMargin, { claimRule, dataKind: "measured" });
  assert.strictEqual(claimBelowMargin.episodeClaims[0].qualityVerdict, "worse");
});

test("elapsed time alone cannot support the lower-cost efficiency claim", () => {
  const runs = [
    run("efficient-spec", { episodeId: "modernization", qualityScore: 95, elapsedSeconds: 400, estimatedCostUsd: null, inputTokens: null }),
    run("frontier-raw", { episodeId: "modernization", qualityScore: 85, elapsedSeconds: 1000, estimatedCostUsd: null, inputTokens: null })
  ];
  const claim = determineClaim(runs, { claimRule, dataKind: "measured" });
  const episodeClaim = claim.episodeClaims[0];
  assert.strictEqual(episodeClaim.status, "inconclusive");
  assert.strictEqual(episodeClaim.efficiencyVerdict, "unavailable");
  assert.strictEqual(episodeClaim.drivingMetric, "unavailable");
});

test("a control-lane hard gate failure is visible but does not block a supported (better) quality result", () => {
  const runs = [
    run("efficient-spec", { episodeId: "modernization", qualityScore: 95, estimatedCostUsd: 1, hardGatesPassed: true }),
    run("frontier-raw", { episodeId: "modernization", qualityScore: 60, estimatedCostUsd: 5, hardGatesPassed: false })
  ];
  const claim = determineClaim(runs, { claimRule, dataKind: "measured" });
  const episodeClaim = claim.episodeClaims[0];
  assert.strictEqual(episodeClaim.status, "supported");
  assert.strictEqual(episodeClaim.controlGatesPassed, false);
  assert.strictEqual(episodeClaim.comparisonGatesPassed, true);
});

test("secondary claim rules are evaluated but never affect the overall status", () => {
  const runs = [
    run("efficient-spec", { episodeId: "modernization", qualityScore: 95, estimatedCostUsd: 1 }),
    run("frontier-raw", { episodeId: "modernization", qualityScore: 85, estimatedCostUsd: 5 }),
    run("efficient-raw", { episodeId: "modernization", qualityScore: 40 })
  ];
  const secondaryClaimRules = [
    {
      id: "efficient-within-model-spec-effect",
      comparisonLane: "efficient-spec",
      controlLane: "efficient-raw",
      description: "test"
    }
  ];
  const claim = determineClaim(runs, { claimRule, secondaryClaimRules, dataKind: "measured" });
  assert.strictEqual(claim.status, "supported");
  assert.strictEqual(claim.secondaryClaims.length, 1);
  assert.strictEqual(claim.secondaryClaims[0].id, "efficient-within-model-spec-effect");
  assert.strictEqual(claim.secondaryClaims[0].results[0].qualityDelta, 55);
});

test("weakestStatus ranks not-supported as weakest and supported as strongest", () => {
  assert.strictEqual(weakestStatus(["supported", "not-supported"]), "not-supported");
  assert.strictEqual(weakestStatus(["supported", "inconclusive"]), "inconclusive");
  assert.strictEqual(weakestStatus(["inconclusive", "not-evaluated"]), "not-evaluated");
  assert.strictEqual(weakestStatus(["supported", "supported"]), "supported");
});
