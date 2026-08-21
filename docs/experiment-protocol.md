# Experiment protocol

## Pre-registered hypothesis

For each episode, `mai-spec` supports the headline hypothesis only when it:

1. passes every applicable hard gate in all three repetitions;
2. achieves equivalent-or-better median quality than `opus-spec`; and
3. uses fewer median **implementation-only tokens** than `opus-spec`.

The overall status is the weaker episode status, never an average. Control-lane
hard-gate failures are displayed prominently but do not make a failing comparison
lane eligible.

## Fixed matrix

- Episodes: `modernization`, `audit-feature`.
- Lanes: `opus-spec`, `mai-spec`.
- Repetitions: three per episode/lane.
- Total implementation cells: 12.
- Authoring sessions: two, one independent Opus session per episode.
- Models: observable IDs `claude-opus-5` and `mai-code-1.1-flash`.
- Reasoning effort: high.
- Timeout: 7,200 seconds symmetrically.
- Tool-call cap: 200 symmetrically.
- Workspaces and conversations: fresh for every run.
- Cross-run memory and human remediation: prohibited.
- Execution order: deterministic, seeded, randomized, and interleaved.

Completed, failed, timed-out, and cancelled terminal states are retained.
Non-completed cells score zero and fail applicable hard gates. Selective reruns
cannot replace a registered cell.

## Fixed inputs

Implementation sessions receive only:

1. the episode task brief;
2. the immutable tagged baseline; and
3. the independently approved specification rendered from its content-bound
   manifest.

They do not receive the authoring transcript, authoring conversation, evaluator,
scoring configuration, prior evidence, expected results, or another run's
context.

## Evaluation and consumption

The sealed evaluator scores functional correctness, behavior preservation,
security controls, maintainability, operability, and scope traceability, then
applies episode hard gates.

Tokens are the primary consumption proxy. Reports preserve uncached input, cached
input, output, and reasoning tokens separately. They show:

- implementation-only totals; and
- end-to-end totals with the one-time episode authoring tokens transparently
  amortized across the three repetitions in each lane.

Productive execution time remains separate from queue/throttle time. Monetary
pricing stays unavailable unless a dated, sourced rate card is supplied before
freeze.

## Fail-closed reporting

Measured reports reject incomplete matrices, duplicate cells/run IDs, mixed
benchmark versions, unexpected cells, selective replacements, execution-policy
drift, and differing spec hashes within an episode.
