import { validateBundle } from "./validate.js";

// Quality scoring dimensions and weights for a spec bundle itself (distinct
// from the benchmark's run-quality scoring in benchmark/config/scoring.json,
// which scores the *output* of a coding agent, not the spec).
export const SPEC_SCORING_WEIGHTS = {
  completeness: 25,
  clarity: 20,
  testability: 25,
  traceabilityCoverage: 20,
  riskCoverage: 10
};

function ratio(numerator, denominator) {
  if (denominator === 0) return 1;
  return Math.max(0, Math.min(1, numerator / denominator));
}

/**
 * Score a spec bundle 0-100 across weighted dimensions and determine
 * whether it is blocked from approval. A bundle is always blocked when a
 * critical ambiguity is unresolved or any requirement/acceptance criterion
 * is untestable, regardless of its numeric score.
 */
export function scoreBundle(bundle) {
  const { errors, criticalBlocks } = validateBundle(bundle);
  const blocked = errors.length > 0 || criticalBlocks.length > 0;

  if (errors.length > 0) {
    return {
      score: 0,
      blocked: true,
      blockingReasons: [...errors, ...criticalBlocks],
      dimensions: null
    };
  }

  const stageCount = 10;
  const presentStages = Object.keys(bundle).length;
  const completeness = ratio(presentStages, stageCount);

  const ambiguities = bundle.ambiguities.items ?? [];
  const resolvedAmbiguities = ambiguities.filter((a) => a.status === "resolved").length;
  const clarity = ratio(resolvedAmbiguities, Math.max(ambiguities.length, 1));

  const requirements = bundle.requirements.items ?? [];
  const acceptance = bundle.acceptanceCriteria.items ?? [];
  const testableRequirements = requirements.filter((r) => r.testable === true).length;
  const testableAcceptance = acceptance.filter((a) => a.testable === true).length;
  const testability = ratio(
    testableRequirements + testableAcceptance,
    requirements.length + acceptance.length || 1
  );

  const requirementIds = new Set(requirements.map((r) => r.id));
  const links = bundle.traceability.links ?? [];
  const coveredRequirementIds = new Set(
    links.filter((l) => (l.acceptanceCriteriaIds ?? []).length > 0).map((l) => l.requirementId)
  );
  const traceabilityCoverage = ratio(coveredRequirementIds.size, requirementIds.size || 1);

  const risks = bundle.risks.items ?? [];
  const mitigatedRisks = risks.filter((r) => Boolean(r.mitigation)).length;
  const riskCoverage = ratio(mitigatedRisks, Math.max(risks.length, 1));

  const dimensions = { completeness, clarity, testability, traceabilityCoverage, riskCoverage };

  let score = 0;
  for (const [key, weight] of Object.entries(SPEC_SCORING_WEIGHTS)) {
    score += dimensions[key] * weight;
  }
  score = Math.round(score * 100) / 100;

  return {
    score: blocked ? 0 : score,
    rawScore: Math.round(score * 100) / 100,
    blocked,
    blockingReasons: criticalBlocks,
    dimensions
  };
}
