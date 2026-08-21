# Benchmark engine

A dependency-free (Node 20+, `node:*` built-ins only) engine that plans,
prepares, imports, scores, aggregates, and reports on the 24-run experiment
defined by `benchmark/config/experiment.json` — 2 episodes ×
4 lanes (efficient/frontier model × raw brief/approved spec) × 3 repetitions.

## Why this exists

The experiment's whole point is a controlled comparison: does an efficient
model given an approved spec (`efficient-spec`) match or beat a frontier
model given only a raw brief (`frontier-raw`)? That only works if:

- every run starts from an identical, hashed baseline snapshot;
- raw lanes structurally cannot see the spec, while spec lanes receive the
  identical raw brief followed by the approved spec;
- run/report artifacts conform to the committed contracts
  (`contracts/run.schema.json`, `contracts/report.schema.json`);
- costs stay `null` until real, dated pricing is configured
  (`benchmark/config/costs.json`), so a claim is never quietly backed by
  invented dollar figures;
- the pre-registered claim rule (`benchmark/config/scoring.json`'s
  `claimRule`) is evaluated mechanically from scored runs, not asserted by
  hand — and illustrative data can **never** produce anything but
  `"not-evaluated"`.

This engine also incorporates a set of independent design-review corrections
(see "Design-review corrections" below) covering evaluator/author blindness,
per-episode hard gates, non-completed-run handling, per-episode claims with
quality/efficiency verdict separation, spread-aware inconclusiveness, cost as
the primary efficiency metric (including amortized spec-authoring cost), an
explicit execution policy, prepare/import consistency + hash provenance,
pre-registered secondary comparisons, gradeable raw-lane traceability, and
richer cost-config provenance.

## Pipeline

```sh
node bin/benchmark.js list-runs [--randomized]
# Lists all 24 planned runs (episode × lane × repetition), derived purely
# from experiment.json — nothing hardcoded. --randomized additionally stamps
# and sorts by a deterministic, seeded execution order (see
# executionPolicy.runOrder / assignRandomizedOrder in runs.js) so runs are
# interleaved across lanes/episodes rather than executed lane-by-lane.

node bin/benchmark.js prepare --run <runId> --baseline <dir> --out <dir>
# Validates lane -> inputMode -> model tier/id consistency against
# experiment.json (validateRunConsistency), then copies <dir> into an
# isolated workspace under <out>/<runId>/workspace, writes PROMPT.md (the
# raw brief for `raw` lanes, or that same brief followed by the rendered
# approved spec for `spec` lanes), a plan.json describing the run, and a provenance.json
# recording exact rendered-prompt/task-brief/spec-manifest/scoring/experiment/
# cost/contract/baseline/plan hashes plus the execution policy in effect.
# Frozen runs materialize tracked baseline bytes directly from the immutable
# Git ref, avoiding checkout line-ending/filter drift.

node bin/benchmark.js import --run-dir <out>/<runId> --execution <execution.json> [--benchmark-version <v>] [--skip-frozen-check]
# Merges plan.json with execution/source/evidence metadata (from
# <execution.json>, produced after the agent actually runs) into a
# contracts/run.schema.json-valid run.json. Failed runs are preserved
# (status: "failed"), never discarded, per executionPolicy.preserveFailedRuns.
# Also validates lane/inputMode/spec-presence and model tier/id consistency
# a second time (post-schema-validation), merges evaluator/costs-config
# hashes and the "frozen versions" actually used (benchmarkVersion,
# baseline ref, executed model id/build, pinned agent version/build and effort params) into
# provenance.json, and auto-computes execution.estimatedCostUsd from token
# usage + benchmark/config/costs.json (including an amortized spec-authoring
# share for spec-lane runs). Measured imports ignore caller-supplied cost.
# Their model identity, randomized order, elapsed limit, and tool-call cap must
# match the frozen policy. Any benchmarkVersion other than "unfrozen" requires a clean,
# committed working tree (git status --porcelain) unless --skip-frozen-check
# is passed. Measured import also reconstructs the registered plan, verifies
# the isolated Git root and baseline tree, and confines all source/evidence
# reads and writes to the prepared run directory.

node bin/benchmark.js score --evaluator <evaluator.json> --episode-id <id> [--execution-status <status>] [--input-mode <raw|spec>]
# Requires evaluator.attestation.independentFromSpecAuthors === true (throws
# otherwise — the evaluator must be a disjoint set of people from that
# episode's spec authors). Computes a weighted 0-100 qualityScore from
# evaluator dimension scores and a per-gate state (passed/failed/
# not-applicable) scoped to --episode-id's applicable hard gates
# (benchmark/config/scoring.json's hardGatesByEpisode) — a gate outside the
# episode's applicable set is always "not-applicable", never silently
# "passed". A non-"completed" --execution-status always forces qualityScore
# to 0 and every applicable gate to "failed". --input-mode raw additionally
# surfaces a non-blocking warning if scopeTraceability scored exactly 0 (see
# benchmark/rubrics/scope-traceability.md).

node bin/benchmark.js aggregate --runs <runs.json>
# Groups scored runs by laneId and computes median/min/max quality,
# hard-gate pass count, median elapsed time, and costMedianUsd (null
# whenever any run in the lane has a null cost — currently always, since
# no dated pricing exists yet).

node bin/benchmark.js report --runs <runs.json> --data-kind <illustrative|measured> --out <report.json> [--freeze-record <freeze.json>] [--benchmark-version <v>]
# Builds and validates a full contracts/report.schema.json report, writes
# it to <report.json>, and writes a supplementary, non-contract
# <report-basename>.claim-detail.json alongside it. A measured report is
# rejected unless all 24 expected run cells are present exactly once, every
# run is measured under the same frozen version, and evaluator/scoring/cost
# hashes plus exact canonical prompts, model, agent, reasoning, evidence paths/content,
# and baseline pins agree. Measured pricing metadata comes only from the
# frozen cost configuration. `--freeze-record` is mandatory for measured
# reports. Quality/gates are re-scored from each sealed evaluator artifact and
# cost is recomputed from frozen pricing plus recorded tokens; supplied outcome
# fields are ignored. Illustrative data is hard-forced
# to overallClaim.status "not-evaluated", with an explicit not-evaluated claim
# for each episode, regardless of the numbers.
```

The active `specforge-fsi-v1.1.0` policy uses a 7,200-second (120-minute)
per-run limit. The exact v1.0.0 configuration remains archived under
`benchmark/config/versions/` with its original 5,400-second limit. Measured
report generation selects the configuration matching the runs' benchmark
version, and report metadata records the applicable timeout and tool-call cap.
Changing the timeout requires a new freeze and a complete symmetric matrix;
selectively rerunning only previously timed-out cells is prohibited.

`<execution.json>` shape for `import`:

```json
{
  "baselineCommit": "<git commit the baseline ref pointed to>",
  "dataKind": "illustrative",
  "freezeRecordSha256": null,
  "freezeRecordPath": null,
  "execution": {
    "status": "completed",
    "order": 1,
    "startedAt": "...", "endedAt": "...", "elapsedSeconds": 0,
    "productiveSeconds": null, "queueSeconds": null,
    "modelId": "mai-code-1.1-flash", "modelBuildId": null,
    "agentVersion": "...", "agentBuildId": null,
    "reasoningEffort": null, "toolCalls": 0,
    "inputTokens": null, "outputTokens": null,
    "cachedInputTokens": 0, "reasoningTokens": 0,
    "estimatedCostUsd": null,
    "firstGreenBuildSeconds": null,
    "firstPassingSuiteSeconds": null,
    "reworkCount": 0,
    "scopeChurnFiles": 0
  },
  "source": {
    "commit": "<final workspace HEAD>",
    "diffPath": "evidence/runs/<runId>/candidate.patch",
    "bundlePath": "evidence/runs/<runId>/source.bundle"
  },
  "evidence": {
    "directory": "evidence/runs/<runId>",
    "transcriptPath": "evidence/runs/<runId>/transcript.log",
    "evaluatorPath": "evidence/runs/<runId>/evaluator.json"
  }
}
```

For measured imports, set `dataKind` to `"measured"` and provide both
`freezeRecordPath` and the record's self-declared `recordSha256` as
`freezeRecordSha256`. The importer loads that record and rejects the run unless
the record is ready and clean, its self-hash is valid, and the exact rendered
prompt plus the prepared baseline, task brief, approved spec, evaluator, scoring, costs, contracts,
executed model ID/build, agent version/build, reasoning effort, execution order,
timeout, and tool-call cap exactly match the frozen values. Import hashes the
source patch, transcript, and evaluator artifact; report generation reopens all
three and rejects changed content. Preparation creates a history-isolated Git
repository, import requires a clean committed workspace, generates the canonical
baseline-to-result patch and a sealed Git bundle, and report verifies that the
claimed source commit is present in that bundle. Every measured source and
evidence path must resolve beneath `--run-dir`; relative paths are repository-root
relative.

`estimatedCostUsd: null` in the input is not necessarily what ends up in
`run.json` — `importRun` auto-computes it from `inputTokens`/`outputTokens`
(and `cachedInputTokens`/`reasoningTokens` if present) via
`cost.js`'s `computeCostUsd`. Caller-supplied cost is accepted only for
illustrative playback; measured import/report always recompute it. A spec-lane
monetary cost remains `null` when its authoring effort is unpriced rather than
silently reporting execution-only spend. The computed value stays `null` until
`benchmark/config/costs.json` carries dated, sourced per-model pricing.

## Design-review corrections

The following independent design-review corrections are implemented. Items
whose full intent would require adding fields to `contracts/run.schema.json`
or `contracts/report.schema.json` (both `additionalProperties: false`, and
out of this engine's ownership scope — see repo-level ownership notes) are
implemented as far as possible using supplementary, non-contract artifacts
(`provenance.json`, `claim-detail.json`) instead; those spots are
called out explicitly below.

1. **Spec/evaluator author separation + blindness attestation.** Spec
   approval (`spec-factory`'s `signoff.json`) records
   `blindnessAttestation`, `authors`/`reviewers`, `authoringEffort`
   (elapsed/tokens/cost), and the bundle hash; an unattested or
   `false`-attested bundle cannot be approved. The mirror-image check lives
   in `scoring.js`: `scoreRun` throws unless
   `evaluator.attestation.independentFromSpecAuthors === true`.
2. **Per-episode hard gates with explicit states.** `scoring.js` computes
   `gateStates` per gate (`passed`/`failed`/`not-applicable`) scoped by
   `scoring.json`'s `hardGatesByEpisode`; modernization's applicable gates
   are `build`, `essential-business-invariants`,
   `no-critical-security-findings`; audit-feature additionally requires
   `maker-checker-separation` and `audit-integrity`. A gate outside the
   episode's applicable set is always `not-applicable`, never silently
   folded into `passed`.
3. **Non-completed runs always included, score 0, fail applicable gates.**
   `scoreRun` forces `qualityScore = 0` and every applicable gate to
   `failed` whenever `executionStatus !== "completed"`, regardless of what
   the evaluator's raw scores/gate entries say.
4. **Per-episode claims; overall = weakest, never averaged; quality vs.
   efficiency verdict separation.** `claim.js`'s `computeEpisodeClaim`
   returns one claim per episode with a `qualityVerdict`
   (better/equivalent/worse/indeterminate) and a separate `efficiencyVerdict`
   (better/equivalent/worse/unavailable) plus `drivingMetric`.
   `determineClaim` computes one `computeEpisodeClaim` per episode and
   combines them via `weakestStatus` — the overall status is always the
   weaker episode's status, never an average. Comparison-lane hard gates
   are load-bearing; control-lane gate failures are computed and reported
   (`comparisonGatesPassed`/`controlGatesPassed`) but never block a
   comparison-lane "better" result. Report schema 1.1 carries the overall and
   episode claims directly; the supplementary claim-detail artifact preserves
   the full internal verdict data and secondary analyses.
5. **Spread-aware inconclusive determination.** Before applying the
   ±margin checks, `computeEpisodeClaim` compares the observed quality delta
   against `max(comparisonLaneSpread, controlLaneSpread)` (each lane's
   `qualityMax - qualityMin`); if the delta doesn't exceed that spread, the
   episode claim is `"inconclusive"` with `qualityVerdict: "indeterminate"`,
   since the difference isn't distinguishable from ordinary run-to-run
   variation. Gate counts and both lanes' quality ranges are included in the
   claim message.
6. **Cost (incl. amortized spec-authoring effort) as primary efficiency
   metric; token use is the only fallback.** `determineEfficiencyVerdict` in
   `claim.js` prefers `costMedianUsd` whenever available for both lanes and
   falls back to total tokens when monetary cost is unavailable. Elapsed and
   productive time remain delivery context and never support a lower-cost
   claim. `cost.js`'s `computeCostUsd` accepts a
   `specAuthoringShareUsd` (via `amortizedSpecAuthoringShareUsd`, dividing
   the spec's one-time authoring cost across `repetitionsPerLane`), which
   `import.js` folds into a spec-lane run's auto-computed cost so the
   comparison reflects the one-time authoring investment amortized across
   its reuse, not just each run's own execution cost.
7. **Explicit execution policy.** `experiment.json`'s `executionPolicy`
   carries `timeoutSeconds`, `toolCallCap`, `runOrder`/`runOrderNotes`, and
   `captureQueueAndThrottleTime`/`queueAndThrottleNotes`; each model entry
   carries `buildId`/`agentVersion`/`agentBuildId`/`effortParams` (pinned, null until dated
   for a frozen measurement). `runs.js`'s `assignRandomizedOrder` stamps a
   deterministic, seeded shuffle (`executionOrder`) onto planned runs so the
   randomized/interleaved order is itself reproducible and auditable rather
   than an unrecorded one-off; `list-runs --randomized` exposes it.
   The imported run records the model build, agent version/build, and reasoning
   effort in its execution and provenance fields under run schema 1.1.
8. **Prepare/import enforce lane → inputMode → spec-presence and model
   tier/id consistency; hash provenance; frozen-clean-version check.**
   `prepare.js`'s `validateRunConsistency` and `import.js`'s
   `validateImportedRunConsistency` both throw on any lane/inputMode
   mismatch, raw-lane-with-non-null-spec, spec-lane-with-null-spec, or
   model tier/id mismatch against `experiment.json`. `prepareRunWorkspace`
   writes `provenance.json` with task-brief/spec-manifest/scoring-config/
   experiment-config/baseline hashes; `importRun` merges in
   evaluator/costs-config/benchmark-engine hashes and the frozen versions actually used.
   Measured import additionally loads and validates the referenced freeze
   record; a correctly shaped hash string is not sufficient.
   `assertFrozenForMeasuredData` (called by the CLI's `import` command
   unless `--skip-frozen-check`) requires a clean, committed working tree
   (`git status --porcelain`) for any `benchmarkVersion` other than
   `"unfrozen"`. `list-runs` has no dedicated "list all frozen versions
   used" report yet beyond what each run's `provenance.json` records
   individually. Report generation rejects mixed frozen versions and any
   incomplete or duplicate measured experiment matrix before adjudicating a
   claim.
9. **Pre-registered secondary within-model spec effects.**
   `scoring.json`'s `secondaryClaimRules` (e.g. comparing `efficient-spec`
   against `efficient-raw` within the same model) are evaluated by
   `claim.js`'s `evaluateSecondaryRule` and returned as `secondaryClaims` —
   informational only, they never gate or average into the primary claim.
   Written to `claim-detail.json` (again, not `report.json`,
   for the same schema reason as item 4).
10. **Raw-lane scope/traceability gradeable, not ID-presence-only.**
    `benchmark/rubrics/scope-traceability.md` defines "inferred requirement
    coverage" scoring for raw lanes (does the delivered change address the
    same underlying scope a competent reading of the task brief implies,
    even without explicit requirement-ID citations) so raw lanes are
    equally gradeable on this dimension rather than structurally capped
    near 0. `scoring.js` surfaces a non-blocking warning whenever a raw-lane
    run's `scopeTraceability` scores exactly 0, pointing back to the rubric.
11. **Cost config supports cached/reasoning tokens and flat charges;
    pricing provenance required.** `costs.json`'s per-model entries carry
    `pricingAsOf`/`source`/`rateType` plus
    `cachedInputPerMillionTokens`/`reasoningOutputPerMillionTokens`/
    `flatChargeUsd`. `cost.js`'s `computeCostUsd` returns `null` unless the
    base rate provenance is fully present, and additionally returns `null`
    (rather than silently pricing at the base rate) if cached/reasoning
    tokens are reported but their own rate isn't configured.
12. **"Worse" = strictly below the -3 margin, not merely outside it.**
    `computeEpisodeClaim` only returns `qualityVerdict: "worse"` when
    `qualityDelta < -claimRule.equivalentWithinPoints`; this is a strict
    less-than, tested at the exact boundary in `claim.test.js`.

## Claim logic

`benchmark/src/claim.js` computes one claim per episode (comparing that
episode's `efficient-spec` runs against its `frontier-raw` runs, per
`benchmark/config/scoring.json`'s `claimRule`), then combines them via
`weakestStatus` — the overall status is always the *weaker* of the two
episode statuses, never an average:

- **not-evaluated** — illustrative data (always), or an episode has zero
  runs in either lane.
- **not-supported** — the comparison lane failed a hard gate on any run, or
  its median quality is strictly more than `equivalentWithinPoints` below
  the control lane's (i.e. `qualityVerdict: "worse"`).
- **inconclusive** — the quality delta is within the observed within-lane
  spread (not distinguishable from run-to-run noise), efficiency evidence is
  unavailable, or quality is non-inferior/better but cost/token use did not
  favor the comparison lane.
- **supported** — quality is non-inferior or better, all comparison-lane
  hard gates passed, and cost or token use was lower for the comparison lane.

The report carries the executive episode and overall claims. The full
per-episode breakdown (`qualityVerdict`, `efficiencyVerdict`, `drivingMetric`,
gate visibility for both lanes) plus pre-registered secondary within-model
comparisons is also written to `claim-detail.json`.

## Testing

```sh
node --test
```

Covers: 24-run planning including randomized-order stamping
(`runs.test.js`), workspace preparation including the raw/spec no-leakage
guarantee, provenance hashing, and lane/model consistency enforcement
(`prepare.test.js`), the hand-rolled schema validator against both contract
schemas (`schema-lite.test.js`), run import including preserved-failure,
baseline/source commit separation, consistency enforcement, provenance
merging, and cost auto-computation/amortization (`import.test.js`), weighted
run scoring, per-episode gate states, the evaluator-blindness requirement,
and non-completed-run forcing (`scoring.test.js`), lane aggregation
including the null-cost rule (`aggregate.test.js`), cost computation
including cached/reasoning-token and flat-charge provenance rules
(`cost.test.js`), per-episode claim outcomes including the spread-based
inconclusive check, the strict "worse" boundary, token-fallback labeling,
control-gate non-blocking, secondary-rule evaluation, and weakest-status
combination (`claim.test.js`), full report assembly/schema
validation/claim-detail separation (`report.test.js`), and CLI command
wiring end-to-end including prepare→import round-trips and the
frozen-clean-version check (`cli.test.js`).

## Illustrative evidence

See `../evidence/illustrative/` for a fabricated example report
(`dataKind: "illustrative"`, `overallClaim.status: "not-evaluated"`, with
not-evaluated episode claims and no secondary measured analyses) used only to exercise the dashboard
before any real runs exist, generated by
`benchmark/scripts/generate-illustrative-evidence.js`.
