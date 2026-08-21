# Experiment protocol

## Registered hypothesis

MAI Code 1.1 Flash with an approved specification will achieve equivalent or better software quality than Claude Opus 5 with only the raw task brief, while using less elapsed time or model cost.

The dashboard must not present this statement as a result until measured runs exist.

## Episodes

### Platform modernization

Starting point: frozen .NET Framework 4.6.2-style trade-reconciliation baseline.

Goal: migrate to .NET 8 while preserving domain behavior and improving architecture, testability, security posture, observability, and operational readiness.

### Explainable audit feature

Starting point: frozen canonical .NET 8 baseline.

Goal: add reason-coded exception resolution, maker-checker separation, append-only evidence with a verifiable SHA-256 chain, concurrency and idempotency safeguards, audit export, telemetry, and sensitive-log protection.

## Run matrix

Each episode has four lanes and three independent repetitions, for 12 runs per episode and 24 runs in total.

The lane controls are:

- Exact baseline commit and archive hash.
- Exact task-brief hash.
- Exact approved-spec hash for spec lanes.
- Fresh workspace and conversation.
- Matching tool permissions and stop rules.
- No human hints, retries, or remediation during scoring.
- Capture of failed, timed-out, and cancelled runs.

Model randomness cannot be fully controlled in an agent environment. Replication and complete failure retention expose that variability rather than hiding it.

Run order is randomized and interleaved across lanes. Model build IDs, agent build, reasoning-effort settings, time limit, tool-call cap, permission profile, execution order, and queue or throttle time are frozen or recorded. Provider queue time is not treated as productive engineering time.

## Specification treatment

Raw lanes receive the concise task brief and baseline only.

Spec lanes receive the same brief plus the approved, hashed bundle. Approval requires:

- No unresolved critical ambiguity.
- Testable acceptance outcomes.
- Traceability from requirement to evidence.
- Explicit goals and non-goals.
- Domain invariants and failure behavior.
- Security, operational, migration, and rollback constraints.
- Recorded review identity and timestamp.
- A blindness attestation confirming that authors and reviewers did not access hidden evaluator source or expected results.
- Every linked acceptance-criterion ID exists and belongs to the linked requirement.

Spec-authoring elapsed time, model usage, and human review effort are recorded. The report shows both per-run execution efficiency and a transparent amortized view of the spec investment.
Approval writes a content-bound manifest. A failed re-approval removes any
previous manifest, and preparation/freeze independently recompute the bundle
hash so changed stage files cannot reuse stale approval.

## Evaluation

The Quality Index is a weighted score:

| Dimension | Weight |
|---|---:|
| Functional correctness | 35 |
| Domain and behavior preservation | 20 |
| Security and control integrity | 15 |
| Maintainability | 15 |
| Operability and resilience | 10 |
| Scope discipline and traceability | 5 |

Quality is reported separately from elapsed time, token use, tool calls, estimated cost, time to first green build, and rework.

The following hard gates apply to modernization:

- Build succeeds.
- Essential business invariants pass.
- No critical security finding exists.

The audit-feature episode adds:

- Maker-checker separation holds.
- Audit integrity holds.

Each gate is recorded as passed, failed, or not applicable. A skipped gate is never treated as passed. Scanner, ruleset, and severity mapping are pinned in the freeze record. Scanner launch failures, timeouts, non-audit exit codes, and malformed output are blocking security findings.

A high aggregate score cannot compensate for a failed hard gate.

Failed, timed-out, and cancelled runs remain in the aggregation with a Quality Index of zero and all applicable gates failed.

## Claim rule

The pre-registered comparison uses marginal lane medians for efficient/spec and frontier/raw. Ranges and gate counts are always shown next to those medians.

- **Equivalent quality:** efficient/spec is within three Quality Index points and its applicable hard gates pass.
- **Better quality:** efficient/spec is more than three points higher and its applicable hard gates pass.
- **Worse quality:** efficient/spec is more than three points lower or fails an applicable hard gate.
- **Inconclusive quality:** evidence is missing or the observed delta is not distinguishable from within-lane spread.
- **Better efficiency:** equivalent-or-better quality plus lower median token or monetary cost after including amortized spec-authoring effort.

Quality and efficiency verdicts are reported separately. Elapsed time is contextual and cannot alone establish the headline efficiency claim. A control-lane gate failure remains prominent but does not penalize the comparison lane. Each episode gets its own claim; the overall status is the weaker episode, never an average.

Secondary, pre-registered analyses measure the spec effect within MAI Code 1.1 Flash and within Claude Opus 5. Scope and traceability are scored against expected requirement coverage in all lanes, not against the presence of spec-only identifiers.

Three repetitions demonstrate spread but do not justify claims of statistical generality across all codebases or models.

## Cost handling

Token counts and elapsed time may be reported as observed. Monetary cost is calculated only when:

- Both model prices come from an approved source.
- The source date is recorded.
- Input and output token units are compatible with that source.
- Any platform multipliers or flat charges are explicitly represented.

Unknown cost is displayed as unavailable, never as zero.

Pricing captures standard, cached, reasoning, and output token classes plus flat charges where applicable. The rate source, effective date, and rate type are required before any monetary comparison. A spec lane is not assigned an execution-only monetary cost when specification-authoring cost is unavailable. Priced authoring effort must be positive when tokens were consumed and must reference independently reviewable cost evidence and its calculation method.

## Run evidence

Every imported run retains:

- Run manifest and hashes.
- Planned and executed model IDs/builds plus agent/runtime versions.
- Start, end, and elapsed times.
- Transcript or session export and its content hash.
- Tool and token usage where available.
- Final source commit, canonical patch, patch content hash, and sealed Git bundle proving the commit exists.
- Build and public-test logs.
- Hidden evaluator output and its content hash.
- Score calculation and hard-gate state.

Measured import reconstructs the registered plan, verifies the prepared plan hash and
isolated baseline Git tree, and rejects source or evidence paths that escape the run
directory.

The report generator includes all eligible runs and does not select a preferred repetition.

All non-completed runs are eligible and receive the registered zero-score treatment. Every frozen benchmark version that produced a measured run is disclosed in the final report, including superseded versions.
