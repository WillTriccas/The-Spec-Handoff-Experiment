import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreRun } from "../src/scoring.js";

const scoringConfig = {
  weights: {
    functionalCorrectness: 35,
    behaviorPreservation: 20,
    securityControls: 15,
    maintainability: 15,
    operability: 10,
    scopeTraceability: 5
  },
  allHardGates: [
    "build",
    "essential-business-invariants",
    "no-critical-security-findings",
    "maker-checker-separation",
    "audit-integrity"
  ],
  hardGatesByEpisode: {
    modernization: ["build", "essential-business-invariants", "no-critical-security-findings"],
    "audit-feature": [
      "build",
      "essential-business-invariants",
      "no-critical-security-findings",
      "maker-checker-separation",
      "audit-integrity"
    ]
  }
};

const attestation = { independentFromSpecAuthors: true, evaluatorNames: ["Test Evaluator"], statement: "No overlap with spec authors." };

function allGatesPassed(episodeId) {
  return Object.fromEntries(scoringConfig.hardGatesByEpisode[episodeId].map((g) => [g, true]));
}

function perfectScores() {
  return {
    functionalCorrectness: 100,
    behaviorPreservation: 100,
    securityControls: 100,
    maintainability: 100,
    operability: 100,
    scopeTraceability: 100
  };
}

test("a perfect evaluator produces a qualityScore of 100", () => {
  const evaluator = { attestation, scores: perfectScores(), hardGates: allGatesPassed("audit-feature") };
  const result = scoreRun(evaluator, { scoringConfig, episodeId: "audit-feature" });
  assert.strictEqual(result.qualityScore, 100);
  assert.strictEqual(result.hardGatesPassed, true);
});

test("qualityScore is the weighted average of dimension scores", () => {
  const evaluator = {
    attestation,
    scores: {
      functionalCorrectness: 80, // *35
      behaviorPreservation: 80, // *20
      securityControls: 80, // *15
      maintainability: 80, // *15
      operability: 80, // *10
      scopeTraceability: 80 // *5
    },
    hardGates: allGatesPassed("audit-feature")
  };
  const result = scoreRun(evaluator, { scoringConfig, episodeId: "audit-feature" });
  assert.strictEqual(result.qualityScore, 80);
});

test("a single low dimension pulls the weighted score down proportionally to its weight", () => {
  const evaluator = {
    attestation,
    scores: {
      functionalCorrectness: 0, // heaviest weight (35) zeroed out
      behaviorPreservation: 100,
      securityControls: 100,
      maintainability: 100,
      operability: 100,
      scopeTraceability: 100
    },
    hardGates: allGatesPassed("audit-feature")
  };
  const result = scoreRun(evaluator, { scoringConfig, episodeId: "audit-feature" });
  assert.strictEqual(result.qualityScore, 65); // 100 - 35
});

test("a missing hard gate counts as failed", () => {
  const evaluator = {
    attestation,
    scores: perfectScores(),
    hardGates: { build: true } // missing the rest
  };
  const result = scoreRun(evaluator, { scoringConfig, episodeId: "audit-feature" });
  assert.strictEqual(result.hardGatesPassed, false);
  assert.ok(result.failedGates.includes("essential-business-invariants"));
  assert.ok(result.failedGates.includes("audit-integrity"));
});

test("an explicit false hard gate is reported as failed", () => {
  const evaluator = {
    attestation,
    scores: perfectScores(),
    hardGates: { ...allGatesPassed("audit-feature"), "no-critical-security-findings": false }
  };
  const result = scoreRun(evaluator, { scoringConfig, episodeId: "audit-feature" });
  assert.strictEqual(result.hardGatesPassed, false);
  assert.deepStrictEqual(result.failedGates, ["no-critical-security-findings"]);
});

test("missing dimensions are reported without crashing", () => {
  const evaluator = { attestation, scores: { functionalCorrectness: 90 }, hardGates: allGatesPassed("audit-feature") };
  const result = scoreRun(evaluator, { scoringConfig, episodeId: "audit-feature" });
  assert.ok(result.missingDimensions.length === 5);
  assert.ok(!Number.isNaN(result.qualityScore));
});

test("gates outside the episode's applicable set are reported as not-applicable, never passed or failed", () => {
  const evaluator = { attestation, scores: perfectScores(), hardGates: allGatesPassed("modernization") };
  const result = scoreRun(evaluator, { scoringConfig, episodeId: "modernization" });
  assert.strictEqual(result.gateStates["maker-checker-separation"], "not-applicable");
  assert.strictEqual(result.gateStates["audit-integrity"], "not-applicable");
  assert.strictEqual(result.gateStates.build, "passed");
  assert.strictEqual(result.hardGatesPassed, true);
  assert.deepStrictEqual(result.applicableGates, ["build", "essential-business-invariants", "no-critical-security-findings"]);
});

test("an evaluator without an independence attestation throws rather than silently scoring", () => {
  const evaluator = { scores: perfectScores(), hardGates: allGatesPassed("audit-feature") };
  assert.throws(() => scoreRun(evaluator, { scoringConfig, episodeId: "audit-feature" }), /attestation/i);
});

test("an evaluator with attestation.independentFromSpecAuthors === false throws", () => {
  const evaluator = {
    attestation: { independentFromSpecAuthors: false },
    scores: perfectScores(),
    hardGates: allGatesPassed("audit-feature")
  };
  assert.throws(() => scoreRun(evaluator, { scoringConfig, episodeId: "audit-feature" }), /attestation/i);
});

test("scoreRun requires an episodeId", () => {
  const evaluator = { attestation, scores: perfectScores(), hardGates: allGatesPassed("audit-feature") };
  assert.throws(() => scoreRun(evaluator, { scoringConfig }), /episodeId/);
});

test("a non-completed run always scores 0 and fails every applicable gate, regardless of evaluator input", () => {
  const evaluator = { attestation, scores: perfectScores(), hardGates: allGatesPassed("audit-feature") };
  const result = scoreRun(evaluator, { scoringConfig, episodeId: "audit-feature", executionStatus: "failed" });
  assert.strictEqual(result.qualityScore, 0);
  assert.strictEqual(result.hardGatesPassed, false);
  for (const gate of scoringConfig.hardGatesByEpisode["audit-feature"]) {
    assert.strictEqual(result.gateStates[gate], "failed");
  }
});

test("a timed-out run is scored the same as any other non-completed status", () => {
  const evaluator = { attestation, scores: perfectScores(), hardGates: allGatesPassed("modernization") };
  const result = scoreRun(evaluator, { scoringConfig, episodeId: "modernization", executionStatus: "timed-out" });
  assert.strictEqual(result.qualityScore, 0);
  assert.strictEqual(result.hardGatesPassed, false);
});

test("scopeTraceability of 0 on a raw-lane run produces a rubric-check warning, not a silent 0", () => {
  const evaluator = {
    attestation,
    scores: { ...perfectScores(), scopeTraceability: 0 },
    hardGates: allGatesPassed("modernization")
  };
  const result = scoreRun(evaluator, { scoringConfig, episodeId: "modernization", inputMode: "raw" });
  assert.ok(result.warnings.some((w) => /scopeTraceability/.test(w)));
});

test("scopeTraceability of 0 on a spec-lane run does not trigger the raw-lane rubric warning", () => {
  const evaluator = {
    attestation,
    scores: { ...perfectScores(), scopeTraceability: 0 },
    hardGates: allGatesPassed("modernization")
  };
  const result = scoreRun(evaluator, { scoringConfig, episodeId: "modernization", inputMode: "spec" });
  assert.strictEqual(result.warnings.length, 0);
});

test("throws for an unknown episodeId", () => {
  const evaluator = { attestation, scores: perfectScores(), hardGates: {} };
  assert.throws(() => scoreRun(evaluator, { scoringConfig, episodeId: "not-a-real-episode" }), /hardGatesByEpisode/);
});
