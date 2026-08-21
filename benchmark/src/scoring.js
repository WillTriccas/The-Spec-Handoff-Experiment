import { loadScoringConfig } from "./config.js";

/**
 * Compute a run's weighted qualityScore from an evaluator's raw dimension
 * scores (each 0-100) using `benchmark/config/scoring.json` weights, and
 * determine the state of every hard gate applicable to the run's episode.
 *
 * `evaluator` shape:
 *   {
 *     attestation: { independentFromSpecAuthors: true, evaluatorNames: [...], statement: "..." },
 *     scores: { functionalCorrectness, behaviorPreservation, securityControls,
 *               maintainability, operability, scopeTraceability }, // each 0-100
 *     hardGates: { build: true, "essential-business-invariants": true, ... }
 *   }
 *
 * `attestation` is mandatory: the people who wrote this evaluator's rubric
 * and scored this run must be a disjoint set from the spec's authors (see
 * spec-factory's signoff.blindnessAttestation, the mirror image of this
 * check). An evaluator record without `attestation.independentFromSpecAuthors
 * === true` cannot be used to score a run -- this throws rather than
 * silently scoring, since a non-independent evaluator invalidates the run's
 * evidentiary value entirely.
 *
 * Hard gates are scoped per episode (`scoringConfig.hardGatesByEpisode`):
 * a gate not applicable to `episodeId` is reported as "not-applicable" and
 * never affects `hardGatesPassed`. Within the applicable gates, a missing
 * entry, an explicit `false`, or any non-`true` value all count as
 * "failed" -- a gate the evaluator did not explicitly mark `true` is never
 * silently treated as passed.
 *
 * Non-completed runs (`executionStatus !== "completed"`, e.g. "failed",
 * "timed-out", "cancelled") always score 0 and fail every applicable gate,
 * regardless of what the evaluator's dimension scores or hard-gate entries
 * say -- an incomplete run cannot be credited with partial quality or
 * partial gate passage.
 */
export function scoreRun(
  evaluator,
  { scoringConfig = loadScoringConfig(), episodeId, executionStatus = "completed", inputMode } = {}
) {
  if (!episodeId) {
    throw new Error("scoreRun requires an episodeId to determine which hard gates apply");
  }
  if (evaluator?.attestation?.independentFromSpecAuthors !== true) {
    throw new Error(
      "Evaluator attestation missing or false: evaluator.attestation.independentFromSpecAuthors must be true. " +
        "The evaluator authors/rubric for a run must be a disjoint set from that episode's spec authors " +
        "(see spec-factory signoff.blindnessAttestation for the mirrored spec-side attestation)."
    );
  }

  const { weights, hardGatesByEpisode } = scoringConfig;
  const applicableGates = hardGatesByEpisode[episodeId];
  if (!applicableGates) {
    throw new Error(`No hardGatesByEpisode entry configured for episode "${episodeId}"`);
  }
  const allGates = scoringConfig.allHardGates ?? applicableGates;

  const isCompleted = executionStatus === "completed";

  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  let weightedSum = 0;
  const missingDimensions = [];
  for (const [dimension, weight] of Object.entries(weights)) {
    const score = evaluator.scores?.[dimension];
    if (typeof score !== "number") {
      missingDimensions.push(dimension);
      continue;
    }
    weightedSum += (score / 100) * weight;
  }

  const rawQualityScore = Math.round(((weightedSum / totalWeight) * 100) * 100) / 100;
  const qualityScore = isCompleted ? rawQualityScore : 0;

  const gateStates = {};
  const failedGates = [];
  for (const gate of allGates) {
    if (!applicableGates.includes(gate)) {
      gateStates[gate] = "not-applicable";
      continue;
    }
    const passed = isCompleted && evaluator.hardGates?.[gate] === true;
    gateStates[gate] = passed ? "passed" : "failed";
    if (!passed) failedGates.push(gate);
  }

  const hardGatesPassed = failedGates.length === 0;

  const warnings = [];
  if (inputMode === "raw" && evaluator.scores?.scopeTraceability === 0) {
    warnings.push(
      "scopeTraceability scored 0 for a raw-lane run: per the rubric guidance (benchmark/rubrics/scope-traceability.md), " +
        "raw lanes must be graded on inferred requirement coverage (does the delivered change address the same underlying " +
        "requirements the spec lane's traceability matrix covers, even without explicit requirement IDs?), not merely docked " +
        "to 0 for lacking explicit traceability-ID citations the raw brief never provided. Re-check this score against the rubric."
    );
  }

  return {
    qualityScore,
    hardGatesPassed,
    gateStates,
    applicableGates,
    failedGates,
    missingDimensions,
    scores: evaluator.scores,
    executionStatus,
    warnings
  };
}

