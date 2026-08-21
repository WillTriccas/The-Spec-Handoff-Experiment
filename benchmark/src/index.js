export const benchmarkContractVersion = "spec-handoff/1.0.0";

export { loadExperimentConfig, loadScoringConfig, loadCostsConfig, loadRunSchema, loadReportSchema } from "./config.js";
export { buildPlannedRuns, plannedRunCount, assignRandomizedOrder } from "./runs.js";
export { prepareAuthoringWorkspace, listAuthoringWorkspaceViolations } from "./authoring.js";
export { prepareRunWorkspace, hashDirectory, hashFile, assertNoSpecLeakage, validateRunConsistency, assertFrozenForMeasuredData } from "./prepare.js";
export { importRun } from "./import.js";
export { scoreRun } from "./scoring.js";
export { computeCostUsd, amortizedSpecAuthoringShareUsd } from "./cost.js";
export { aggregateLane, aggregateEpisode, groupByLane, median } from "./aggregate.js";
export { determineClaim, computeEpisodeClaim, weakestStatus } from "./claim.js";
export { buildReport, writeReport, writeClaimDetail } from "./report.js";
export { createFreezeReadiness, writeFreezeReadiness } from "./freeze.js";
export { validateAgainstSchema, assertValidAgainstSchema } from "./schema-lite.js";
