import { readFileSync } from "node:fs";
import { loadExperimentConfig, loadScoringConfig } from "./config.js";
import { buildPlannedRuns, plannedRunCount, assignRandomizedOrder } from "./runs.js";
import { prepareRunWorkspace, assertFrozenForMeasuredData } from "./prepare.js";
import { importRun } from "./import.js";
import { scoreRun } from "./scoring.js";
import { aggregateLane, groupByLane } from "./aggregate.js";
import { buildReport, writeReport, writeClaimDetail } from "./report.js";
import { createFreezeReadiness, writeFreezeReadiness } from "./freeze.js";
import { prepareAuthoringWorkspace } from "./authoring.js";

function printUsage() {
  console.log(`benchmark <command> [options]

Commands:
  prepare-authoring --episode <id> --out <dir> Prepare an evaluator-blind specification workspace
  list-runs [--randomized]                    List all planned runs (12 by default); --randomized
                                               shows the seeded execution order per executionPolicy.runOrder
  prepare --run <id> --baseline <dir> --out <dir>
                                               Prepare an isolated workspace for one planned run
  import --run-dir <dir> --execution <file> [--benchmark-version <v>] [--skip-frozen-check]
                                               Import execution metadata/evidence into run.json
  score --evaluator <file> --episode-id <id> [--execution-status <status>] [--input-mode <raw|spec>]
                                               Score one run's evaluator JSON against scoring.json
  aggregate --runs <file>                     Aggregate scored runs (JSON array) into lane summaries
  report --runs <file> --data-kind <illustrative|measured> --out <file> [--benchmark-version <v>]
                                               Build and write a full evidence report plus claim-detail.json
  freeze --out <file>                           Write machine-readable freeze readiness; exits 2 while blocked
`);
}

function parseOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        options[key] = true; // boolean flag, e.g. --randomized, --skip-frozen-check
      } else {
        options[key] = next;
        i += 1;
      }
    }
  }
  return options;
}

export function cmdListRuns(options = {}) {
  const config = loadExperimentConfig();
  let runs = buildPlannedRuns(config);
  console.log(`Planned runs: ${runs.length} (expected ${plannedRunCount(config)})`);
  if (options.randomized) {
    runs = assignRandomizedOrder(runs);
    runs.sort((a, b) => a.executionOrder - b.executionOrder);
    console.log(`Execution order per executionPolicy.runOrder ("${config.executionPolicy?.runOrder ?? "unspecified"}"):`);
    for (const run of runs) {
      console.log(
        `#${String(run.executionOrder).padStart(2, "0")} ${run.runId.padEnd(28)} episode=${run.episodeId.padEnd(14)} lane=${run.laneId.padEnd(15)} model=${run.modelDisplayName.padEnd(20)} mode=${run.inputMode.padEnd(4)} rep=${run.repetition}`
      );
    }

    return 0;
  }
  for (const run of runs) {
    console.log(
      `${run.runId.padEnd(28)} episode=${run.episodeId.padEnd(14)} lane=${run.laneId.padEnd(15)} model=${run.modelDisplayName.padEnd(20)} mode=${run.inputMode.padEnd(4)} rep=${run.repetition}`
    );
  }
  return 0;
}

export function cmdPrepareAuthoring(options) {
  const { episode, out } = options;
  if (!episode || !out) {
    console.error("Usage: benchmark prepare-authoring --episode <id> --out <dir>");
    return 1;
  }
  const result = prepareAuthoringWorkspace(episode, out);
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

export function cmdPrepare(options) {
  const { run: runId, baseline, out } = options;
  if (!runId || !baseline || !out) {
    console.error("Usage: benchmark prepare --run <id> --baseline <dir> --out <dir>");
    return 1;
  }
  const runs = assignRandomizedOrder(buildPlannedRuns());
  const run = runs.find((r) => r.runId === runId);
  if (!run) {
    console.error(`Unknown run id: ${runId}`);
    return 1;
  }
  const result = prepareRunWorkspace(run, { baselineDir: baseline, outputRoot: out });
  console.log(JSON.stringify({ runDir: result.runDir, promptPath: result.promptPath, planPath: result.planPath, provenancePath: result.provenancePath }, null, 2));
  return 0;
}

export function cmdImport(options) {
  const { "run-dir": runDir, execution: executionPath, "benchmark-version": benchmarkVersion, "skip-frozen-check": skipFrozenCheck } = options;
  if (!runDir || !executionPath) {
    console.error("Usage: benchmark import --run-dir <dir> --execution <file> [--benchmark-version <v>] [--skip-frozen-check]");
    return 1;
  }
  const resolvedBenchmarkVersion = benchmarkVersion ?? loadExperimentConfig().benchmarkVersion;
  // Per correction item 8, measured data (any benchmarkVersion other than
  // "unfrozen") must come from a clean, committed working tree. Allow an
  // explicit opt-out for exceptional/manual scenarios.
  if (!skipFrozenCheck) {
    assertFrozenForMeasuredData(resolvedBenchmarkVersion);
  }
  const executionInput = JSON.parse(readFileSync(executionPath, "utf8"));
  const { run, provenancePath } = importRun({
    runDir,
    benchmarkVersion: resolvedBenchmarkVersion,
    dataKind: executionInput.dataKind ?? (resolvedBenchmarkVersion === "unfrozen" ? "illustrative" : "measured"),
    freezeRecordSha256: executionInput.freezeRecordSha256 ?? null,
    freezeRecordPath: executionInput.freezeRecordPath ?? null,
    baselineCommit: executionInput.baselineCommit,
    execution: executionInput.execution,
    source: executionInput.source,
    evidence: executionInput.evidence
  });
  console.log(JSON.stringify({ run, provenancePath }, null, 2));
  return 0;
}

export function cmdScore(options) {
  const { evaluator: evaluatorPath, "episode-id": episodeId, "execution-status": executionStatus, "input-mode": inputMode } = options;
  if (!evaluatorPath || !episodeId) {
    console.error("Usage: benchmark score --evaluator <file> --episode-id <id> [--execution-status <status>] [--input-mode <raw|spec>]");
    return 1;
  }
  const evaluator = JSON.parse(readFileSync(evaluatorPath, "utf8"));
  const result = scoreRun(evaluator, {
    scoringConfig: loadScoringConfig(),
    episodeId,
    executionStatus: executionStatus ?? "completed",
    inputMode
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.warnings.length > 0) {
    for (const warning of result.warnings) console.error(`warning: ${warning}`);
  }
  return result.hardGatesPassed ? 0 : 1;
}

export function cmdAggregate(options) {
  const { runs: runsPath } = options;
  if (!runsPath) {
    console.error("Usage: benchmark aggregate --runs <file>");
    return 1;
  }
  const runs = JSON.parse(readFileSync(runsPath, "utf8"));
  const byLane = groupByLane(runs);
  const summaries = [...byLane.values()].map((laneRuns) => aggregateLane(laneRuns));
  console.log(JSON.stringify(summaries, null, 2));
  return 0;
}

export function cmdReport(options) {
  const { runs: runsPath, "data-kind": dataKind, out, "pricing-as-of": pricingAsOf, "freeze-record": freezeRecordPath, "benchmark-version": benchmarkVersionOption } = options;
  if (!runsPath || !dataKind || !out) {
    console.error("Usage: benchmark report --runs <file> --data-kind <illustrative|measured> --out <file> [--freeze-record <file>]");
    return 1;
  }

  const runs = JSON.parse(readFileSync(runsPath, "utf8"));
  const measuredVersions =
    dataKind === "measured"
      ? [...new Set(runs.map((run) => run.benchmarkVersion))]
      : [];
  if (measuredVersions.length > 1) {
    throw new Error("Measured report input contains mixed benchmark versions");
  }
  const reportBenchmarkVersion =
    dataKind === "measured"
      ? benchmarkVersionOption ?? measuredVersions[0]
      : "unfrozen";
  const experimentConfig =
    dataKind === "measured"
      ? loadExperimentConfig(reportBenchmarkVersion)
      : loadExperimentConfig();
  if (dataKind === "measured") {
    assertFrozenForMeasuredData(reportBenchmarkVersion);
  }
  const { report, claimDetail } = buildReport({
    runs,
    benchmarkVersion:
      reportBenchmarkVersion,
    repetitionsPerLane: experimentConfig.repetitionsPerLane,
    dataKind,
    pricingAsOf: pricingAsOf ?? null,
    experimentConfig,
    freezeRecordPath: freezeRecordPath ?? null
  });
  writeReport(report, out);
  const claimDetailPath = out.replace(/\.json$/i, "") + ".claim-detail.json";
  writeClaimDetail(claimDetail, claimDetailPath);
  console.log(`Wrote report to ${out} (claim: ${report.overallClaim.status}) and claim detail to ${claimDetailPath}`);
  return 0;
}

export function cmdFreeze(options) {
  const { out } = options;
  if (!out) {
    console.error("Usage: benchmark freeze --out <file>");
    return 1;
  }
  const readiness = createFreezeReadiness();
  writeFreezeReadiness(readiness, out);
  console.log(
    `Wrote freeze readiness to ${out} (ready: ${readiness.ready}; blockers: ${readiness.blockers.length})`
  );
  return readiness.ready ? 0 : 2;
}

export function run(argv) {
  const [command, ...rest] = argv;
  const options = parseOptions(rest);
  switch (command) {
    case "prepare-authoring":
      return cmdPrepareAuthoring(options);
    case "list-runs":
      return cmdListRuns(options);
    case "prepare":
      return cmdPrepare(options);
    case "import":
      return cmdImport(options);
    case "score":
      return cmdScore(options);
    case "aggregate":
      return cmdAggregate(options);
    case "report":
      return cmdReport(options);
    case "freeze":
      return cmdFreeze(options);
    default:
      printUsage();
      return command ? 1 : 0;
  }
}
