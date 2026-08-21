/**
 * Compute a run's estimated cost in USD from token usage, per
 * `benchmark/config/costs.json`'s per-model pricing.
 *
 * Returns `null` whenever full pricing provenance is not configured for the
 * given model -- specifically, `pricingAsOf`, `source`, `rateType`, and the
 * base `inputPerMillionTokens`/`outputPerMillionTokens` rates must all be
 * present and non-null. This is intentional and expected to remain the
 * default state until a dated, sourced pricing card is entered: per the
 * committed experiment contract, costs must stay null rather than being
 * silently estimated from an unconfigured or undated rate.
 *
 * Supports (per correction item 11):
 *   - cached input tokens, priced via `cachedInputPerMillionTokens` if the
 *     model reports any and a rate is configured (otherwise this function
 *     returns null rather than silently pricing cached tokens at the
 *     regular input rate, which would misrepresent the actual spend);
 *   - reasoning output tokens, priced via `reasoningOutputPerMillionTokens`
 *     under the same rule;
 *   - a flat per-run charge (`flatChargeUsd`), for models/deployments billed
 *     via a fixed allocation rather than pure token metering;
 *   - amortized spec-authoring cost (correction item 6): when `inputMode`
 *     is "spec", pass `specAuthoringShareUsd` (typically the approved
 *     spec's total authoring cost divided across the repetitions that will
 *     consume it) and it is added to the run's own token cost, so that the
 *     efficiency comparison for spec lanes reflects the one-time authoring
 *     investment amortized across its reuse, not just the run's own
 *     execution cost.
 */
export function computeCostUsd({
  modelId,
  inputTokens,
  outputTokens,
  cachedInputTokens = 0,
  reasoningOutputTokens = 0,
  costsConfig,
  specAuthoringShareUsd = null,
  requiresSpecAuthoringCost = false
}) {
  const model = costsConfig?.models?.[modelId];
  if (!model) return null;

  const provenanceComplete =
    model.pricingAsOf != null &&
    model.source != null &&
    model.rateType != null &&
    typeof model.inputPerMillionTokens === "number" &&
    typeof model.outputPerMillionTokens === "number";
  if (!provenanceComplete) return null;

  if (typeof inputTokens !== "number" || typeof outputTokens !== "number") return null;

  let total = 0;
  total += (inputTokens / 1_000_000) * model.inputPerMillionTokens;
  total += (outputTokens / 1_000_000) * model.outputPerMillionTokens;

  if (cachedInputTokens > 0) {
    if (typeof model.cachedInputPerMillionTokens !== "number") return null;
    total += (cachedInputTokens / 1_000_000) * model.cachedInputPerMillionTokens;
  }

  if (reasoningOutputTokens > 0) {
    if (typeof model.reasoningOutputPerMillionTokens !== "number") return null;
    total += (reasoningOutputTokens / 1_000_000) * model.reasoningOutputPerMillionTokens;
  }

  if (typeof model.flatChargeUsd === "number") {
    total += model.flatChargeUsd;
  }

  if (requiresSpecAuthoringCost && typeof specAuthoringShareUsd !== "number") {
    return null;
  }
  if (specAuthoringShareUsd != null) {
    if (typeof specAuthoringShareUsd !== "number") return null;
    total += specAuthoringShareUsd;
  }

  return Math.round(total * 1_000_000) / 1_000_000;
}

/**
 * Compute the per-repetition amortized share of an approved spec's
 * authoring cost, for inclusion in spec-lane run costs per correction item
 * 6. Returns null unless the spec's manifest.authoringEffort.estimatedCostUsd
 * is itself a number (it stays null until token costs are priced, same as
 * everything else in this module) and repetitionsPerLane is a positive
 * integer.
 */
export function amortizedSpecAuthoringShareUsd(authoringEffort, repetitionsPerLane) {
  if (!authoringEffort || typeof authoringEffort.estimatedCostUsd !== "number") return null;
  const meteredTokens =
    (authoringEffort.inputTokens ?? 0) + (authoringEffort.outputTokens ?? 0);
  if (meteredTokens > 0 && authoringEffort.estimatedCostUsd <= 0) return null;
  if (
    typeof authoringEffort.costEvidenceRef !== "string" ||
    authoringEffort.costEvidenceRef.length === 0 ||
    typeof authoringEffort.costMethod !== "string" ||
    authoringEffort.costMethod.length === 0
  ) {
    return null;
  }
  if (!Number.isInteger(repetitionsPerLane) || repetitionsPerLane <= 0) return null;
  return Math.round((authoringEffort.estimatedCostUsd / repetitionsPerLane) * 1_000_000) / 1_000_000;
}
