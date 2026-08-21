import { aggregateLane } from "./aggregate.js";

function compareLower(comparison, control) {
  if (typeof comparison !== "number" || typeof control !== "number") {
    return "unavailable";
  }
  if (comparison < control) return "better";
  if (comparison > control) return "worse";
  return "equivalent";
}

function emptyClaim(episodeId, message) {
  return {
    episodeId,
    status: "not-evaluated",
    qualityVerdict: "indeterminate",
    timeVerdict: "unavailable",
    tokenVerdict: "unavailable",
    efficiencyVerdict: "unavailable",
    drivingMetric: "unavailable",
    qualityDelta: null,
    productiveTimeDeltaSeconds: null,
    implementationTokenDelta: null,
    costSavingPercent: null,
    comparisonGatesPassed: null,
    controlGatesPassed: null,
    message
  };
}

export function computeEpisodeClaim(
  episodeId,
  comparisonRuns,
  controlRuns,
  { claimRule }
) {
  if (comparisonRuns.length === 0 || controlRuns.length === 0) {
    return emptyClaim(
      episodeId,
      `Insufficient data for both "${claimRule.comparisonLane}" and "${claimRule.controlLane}".`
    );
  }

  const comparison = aggregateLane(comparisonRuns);
  const control = aggregateLane(controlRuns);
  const qualityDelta =
    Math.round((comparison.qualityMedian - control.qualityMedian) * 100) / 100;
  const productiveTimeDeltaSeconds =
    typeof comparison.productiveMedianSeconds === "number" &&
    typeof control.productiveMedianSeconds === "number"
      ? comparison.productiveMedianSeconds - control.productiveMedianSeconds
      : null;
  const implementationTokenDelta =
    typeof comparison.implementationTokenMedian === "number" &&
    typeof control.implementationTokenMedian === "number"
      ? comparison.implementationTokenMedian - control.implementationTokenMedian
      : null;
  const timeVerdict = compareLower(
    comparison.productiveMedianSeconds,
    control.productiveMedianSeconds
  );
  const tokenVerdict = compareLower(
    comparison.implementationTokenMedian,
    control.implementationTokenMedian
  );
  const comparisonGatesPassed =
    comparison.hardGatePassCount === comparison.runCount;
  const controlGatesPassed = control.hardGatePassCount === control.runCount;
  const gateNote =
    `Comparison gates: ${comparison.hardGatePassCount}/${comparison.runCount}. ` +
    `Control gates: ${control.hardGatePassCount}/${control.runCount}.`;
  let qualityVerdict;
  if (qualityDelta < -claimRule.equivalentWithinPoints) {
    qualityVerdict = "worse";
  } else if (qualityDelta > claimRule.betterByMoreThanPoints) {
    qualityVerdict = "better";
  } else {
    qualityVerdict = "equivalent";
  }

  if (claimRule.requireAllHardGates && !comparisonGatesPassed) {
    return {
      ...emptyClaim(episodeId, ""),
      status: "not-supported",
      qualityVerdict,
      timeVerdict,
      tokenVerdict,
      efficiencyVerdict:
        timeVerdict === "better" && tokenVerdict === "better"
          ? "better"
          : timeVerdict === "unavailable" || tokenVerdict === "unavailable"
            ? "unavailable"
            : "worse",
      drivingMetric:
        timeVerdict === "unavailable" || tokenVerdict === "unavailable"
          ? "unavailable"
          : "time-and-tokens",
      qualityDelta,
      productiveTimeDeltaSeconds,
      implementationTokenDelta,
      comparisonGatesPassed,
      controlGatesPassed,
      message: `The spec-driven MAI lane failed one or more applicable hard gates. ${gateNote}`
    };
  }

  if (qualityVerdict === "worse") {
    return {
      ...emptyClaim(episodeId, ""),
      status: "not-supported",
      qualityVerdict,
      timeVerdict,
      tokenVerdict,
      efficiencyVerdict:
        timeVerdict === "better" && tokenVerdict === "better"
          ? "better"
          : "worse",
      drivingMetric: "time-and-tokens",
      qualityDelta,
      productiveTimeDeltaSeconds,
      implementationTokenDelta,
      comparisonGatesPassed,
      controlGatesPassed,
      message: `MAI with the Opus-authored Spec Kit handoff scored below direct Opus beyond the non-inferiority margin. ${gateNote}`
    };
  }

  const measurementsAvailable =
    timeVerdict !== "unavailable" && tokenVerdict !== "unavailable";
  const efficiencyVerdict = !measurementsAvailable
    ? "unavailable"
    : timeVerdict === "better" && tokenVerdict === "better"
      ? "better"
      : timeVerdict === "equivalent" && tokenVerdict === "equivalent"
        ? "equivalent"
        : "worse";
  const status =
    ["better", "equivalent"].includes(qualityVerdict) &&
    timeVerdict === "better" &&
    tokenVerdict === "better"
      ? "supported"
      : "inconclusive";

  return {
    episodeId,
    status,
    qualityVerdict,
    timeVerdict,
    tokenVerdict,
    efficiencyVerdict,
    drivingMetric: measurementsAvailable
      ? "time-and-tokens"
      : "unavailable",
    qualityDelta,
    productiveTimeDeltaSeconds,
    implementationTokenDelta,
    costSavingPercent: null,
    comparisonGatesPassed,
    controlGatesPassed,
    message:
      `MAI Spec Kit vs direct Opus: quality=${qualityVerdict} (${qualityDelta} points), ` +
      `productive time=${timeVerdict} (${productiveTimeDeltaSeconds ?? "unavailable"} seconds), ` +
      `implementation tokens=${tokenVerdict} (${implementationTokenDelta ?? "unavailable"}). ${gateNote}`
  };
}

const STATUS_STRENGTH = {
  supported: 3,
  inconclusive: 2,
  "not-evaluated": 1,
  "not-supported": 0
};

export function weakestStatus(statuses) {
  return statuses.reduce((weakest, status) =>
    STATUS_STRENGTH[status] < STATUS_STRENGTH[weakest] ? status : weakest
  );
}

export function determineClaim(
  allRuns,
  { claimRule, dataKind, episodeOrder = [] }
) {
  const episodeIds = [
    ...new Set(allRuns.map((run) => run.episodeId))
  ];
  if (dataKind === "illustrative") {
    const episodeClaims = episodeIds.map((episodeId) =>
      emptyClaim(
        episodeId,
        "No measured implementation runs have been evaluated."
      )
    );
    return {
      ...emptyClaim(
        null,
        "No measured implementation runs have been evaluated."
      ),
      episodeClaims,
      secondaryClaims: []
    };
  }

  const rank = new Map(
    episodeOrder.map((episodeId, index) => [episodeId, index])
  );
  const episodeClaims = episodeIds
    .sort(
      (left, right) =>
        (rank.get(left) ?? Number.MAX_SAFE_INTEGER) -
          (rank.get(right) ?? Number.MAX_SAFE_INTEGER) ||
        left.localeCompare(right)
    )
    .map((episodeId) => {
      const runs = allRuns.filter((run) => run.episodeId === episodeId);
      return computeEpisodeClaim(
        episodeId,
        runs.filter((run) => run.laneId === claimRule.comparisonLane),
        runs.filter((run) => run.laneId === claimRule.controlLane),
        { claimRule }
      );
    });

  if (episodeClaims.length === 0) {
    return {
      ...emptyClaim(null, "No episodes were present."),
      episodeClaims: [],
      secondaryClaims: []
    };
  }
  const status = weakestStatus(episodeClaims.map((claim) => claim.status));
  const driving = episodeClaims.find((claim) => claim.status === status);
  return {
    status,
    qualityVerdict: driving.qualityVerdict,
    timeVerdict: driving.timeVerdict,
    tokenVerdict: driving.tokenVerdict,
    efficiencyVerdict: driving.efficiencyVerdict,
    drivingMetric: driving.drivingMetric,
    qualityDelta: driving.qualityDelta,
    productiveTimeDeltaSeconds: driving.productiveTimeDeltaSeconds,
    implementationTokenDelta: driving.implementationTokenDelta,
    costSavingPercent: null,
    message:
      `Overall status is the weaker of the per-episode comparisons. ` +
      episodeClaims.map((claim) => `[${claim.episodeId}: ${claim.status}]`).join(" "),
    episodeClaims,
    secondaryClaims: []
  };
}
