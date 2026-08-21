function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Aggregate a list of scored runs (all sharing the same laneId) into the
 * `laneSummary` shape required by `contracts/report.schema.json`.
 *
 * `runs` items must have: qualityScore, hardGatesPassed, elapsedSeconds,
 * estimatedCostUsd (nullable), laneId, modelDisplayName, inputMode.
 *
 * `costMedianUsd` is null whenever any run in the lane has a null cost —
 * per the experiment contract, costs remain null until dated pricing is
 * configured, so this is expected to be null for the foreseeable future
 * rather than silently computed from a partial subset.
 */
export function aggregateLane(runs) {
  if (runs.length === 0) {
    throw new Error("Cannot aggregate an empty run list");
  }
  const [{ laneId, modelDisplayName, inputMode }] = runs;

  const qualityScores = runs.map((r) => r.qualityScore);
  const elapsedSeconds = runs.map((r) => r.elapsedSeconds);
  const productiveSeconds = runs.map((r) => r.productiveSeconds ?? r.productiveDurationSeconds ?? null);
  const implementationTokenTotals = runs.map((r) => {
    const categories = [
      r.inputTokens,
      r.cachedInputTokens,
      r.outputTokens,
      r.reasoningTokens ?? r.reasoningOutputTokens
    ];
    return categories.every((value) => value !== null && value !== undefined)
      ? categories.reduce((sum, value) => sum + value, 0)
      : null;
  });
  const endToEndTokenTotals = implementationTokenTotals.map((value, index) =>
    typeof value === "number"
      ? value + (runs[index].specAuthoringAmortizedTokens ?? 0)
      : null
  );
  const endToEndProductiveSeconds = productiveSeconds.map((value, index) =>
    typeof value === "number"
      ? value + (runs[index].specAuthoringAmortizedSeconds ?? 0)
      : null
  );
  const categoryMedian = (field, fallback = null) => {
    const values = runs.map((run) => run[field] ?? (fallback ? run[fallback] : null));
    return values.every((value) => typeof value === "number") ? median(values) : null;
  };
  const hardGatePassCount = runs.filter((r) => r.hardGatesPassed).length;

  const costs = runs.map((r) => r.estimatedCostUsd);
  const costMedianUsd = costs.some((c) => c === null || c === undefined) ? null : median(costs);

  return {
    laneId,
    modelDisplayName,
    inputMode,
    qualityMedian: median(qualityScores),
    qualityMin: Math.min(...qualityScores),
    qualityMax: Math.max(...qualityScores),
    hardGatePassCount,
    hardGateFailCount: runs.length - hardGatePassCount,
    runCount: runs.length,
    elapsedMedianSeconds: median(elapsedSeconds),
    productiveMedianSeconds: productiveSeconds.every((value) => typeof value === "number")
      ? median(productiveSeconds)
      : null,
    endToEndProductiveMedianSeconds:
      endToEndProductiveSeconds.every((value) => typeof value === "number")
        ? median(endToEndProductiveSeconds)
        : null,
    uncachedInputTokenMedian: categoryMedian("inputTokens"),
    cachedInputTokenMedian: categoryMedian("cachedInputTokens"),
    outputTokenMedian: categoryMedian("outputTokens"),
    reasoningTokenMedian: categoryMedian("reasoningTokens", "reasoningOutputTokens"),
    implementationTokenMedian: implementationTokenTotals.every((value) => typeof value === "number")
      ? median(implementationTokenTotals)
      : null,
    endToEndTokenMedian: endToEndTokenTotals.every((value) => typeof value === "number")
      ? median(endToEndTokenTotals)
      : null,
    tokenMedian: implementationTokenTotals.every((value) => typeof value === "number")
      ? median(implementationTokenTotals)
      : null,
    costMedianUsd
  };
}

export function groupByLane(runs) {
  const byLane = new Map();
  for (const run of runs) {
    if (!byLane.has(run.laneId)) byLane.set(run.laneId, []);
    byLane.get(run.laneId).push(run);
  }
  return byLane;
}

export function aggregateEpisode(runs) {
  const byLane = groupByLane(runs);
  return [...byLane.values()].map((laneRuns) => aggregateLane(laneRuns));
}

export { median };
