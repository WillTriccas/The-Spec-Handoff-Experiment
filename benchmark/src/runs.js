import { loadExperimentConfig } from "./config.js";

/**
 * Build the full list of planned runs from the experiment config: every
 * combination of episode × lane × repetition. With 2 episodes, 2 lanes and
 * 3 repetitions per lane this is exactly 12 runs.
 */
export function buildPlannedRuns(experimentConfig = loadExperimentConfig()) {
  const runs = [];
  for (const episode of experimentConfig.episodes) {
    for (const lane of experimentConfig.lanes) {
      const model = experimentConfig.models[lane.modelTier];
      for (let repetition = 1; repetition <= experimentConfig.repetitionsPerLane; repetition += 1) {
        runs.push({
          runId: `${episode.id}-${lane.id}-r${repetition}`,
          episodeId: episode.id,
          episodeName: episode.name,
          laneId: lane.id,
          modelTier: lane.modelTier,
          modelId: model.id,
          modelDisplayName: model.displayName,
          modelBuildId: model.buildId ?? null,
          modelAgentVersion: model.agentVersion ?? null,
          modelAgentBuildId: model.agentBuildId ?? null,
          modelEffortParams: model.effortParams ?? null,
          inputMode: lane.inputMode,
          repetition,
          baselineRef: episode.baselineRef,
          baselinePath: episode.baselinePath,
          taskBrief: episode.taskBrief,
          specBundle: episode.specBundle
        });
      }
    }
  }
  return runs;
}

export function plannedRunCount(experimentConfig = loadExperimentConfig()) {
  return (
    experimentConfig.episodes.length *
    experimentConfig.lanes.length *
    experimentConfig.repetitionsPerLane
  );
}

/**
 * Deterministic mulberry32 PRNG. Used only to produce a reproducible,
 * auditable shuffle of run execution order -- not for anything
 * security-sensitive.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

/**
 * Assign a randomized, cross-lane-interleaved execution order to a set of
 * planned runs, per the experiment's `executionPolicy.runOrder` guardrail
 * (runs must not be grouped lane-by-lane or episode-by-episode, so that
 * time-of-day/infrastructure drift can't confound one lane).
 *
 * The shuffle is deterministic given the same `seed` so the intended
 * execution order is itself an auditable, reproducible artifact rather than
 * an unrecorded one-off -- re-running this with the same seed and the same
 * planned runs always yields the same order. Returns a *new* array; the
 * input `runs` are not mutated. Each returned run is annotated with a
 * 1-based `executionOrder`.
 */
export function assignRandomizedOrder(
  runs,
  seed = loadExperimentConfig().executionPolicy.runOrderSeed
) {
  const rand = mulberry32(seedFromString(String(seed)));
  const shuffled = [...runs];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const interleaved = [];
  while (shuffled.length > 0) {
    const previous = interleaved.at(-1);
    let nextIndex = 0;
    if (previous) {
      nextIndex = shuffled.findIndex(
        (run) =>
          run.episodeId !== previous.episodeId &&
          run.laneId !== previous.laneId
      );
      if (nextIndex < 0) {
        nextIndex = shuffled.findIndex(
          (run) => run.episodeId !== previous.episodeId
        );
      }
      if (nextIndex < 0) {
        nextIndex = shuffled.findIndex((run) => run.laneId !== previous.laneId);
      }
      if (nextIndex < 0) nextIndex = 0;
    }
    interleaved.push(shuffled.splice(nextIndex, 1)[0]);
  }
  return interleaved.map((run, index) => ({
    ...run,
    executionOrder: index + 1
  }));
}
