# Experiment protocol

## Question

Can MAI Code 1.1 Flash execute a high-quality Opus-authored GitHub Spec Kit
handoff as effectively as Claude Opus 5 tackles the same task directly without a
specification?

## Lanes

| Lane | Model | Inputs |
|---|---|---|
| `mai-spec` | MAI Code 1.1 Flash | Task brief, immutable baseline, approved Opus-authored Spec Kit artifacts |
| `opus-raw` | Claude Opus 5 | Task brief and immutable baseline only |

Each lane runs three fresh repetitions for each of two episodes: 12
implementation cells total. Workspaces and conversations are isolated, execution
is deterministically interleaved, cross-run memory and human remediation are
prohibited, and all terminal states are retained.

## Opus specification authoring

One fresh Opus session per episode follows the GitHub Spec Kit sequence pinned in
`benchmark/config/experiment.json`:

1. constitution;
2. specify;
3. clarify;
4. plan;
5. requirements-quality checklist;
6. tasks;
7. analyze.

The result is `constitution.md`, `spec.md`, `plan.md`, `tasks.md`,
`analysis.md`, and `checklists/requirements.md`. Implementation is deliberately deferred to
`mai-spec`. Independent approval creates one content-addressed manifest reused by
all three MAI repetitions. Opus authoring remains blind to evaluator source,
hidden fixtures, scores, evidence, and expected results.

## Measurements

Primary comparisons, per episode and overall:

1. sealed evaluator output quality score;
2. median productive execution seconds;
3. median implementation tokens, with uncached input, cached input, output, and
   reasoning tokens retained separately.

Secondary context includes wall-clock elapsed time, queue/throttle time, and
Spec Kit authoring time/tokens amortized across the three MAI repetitions.
Monetary cost is unavailable unless a dated source is frozen.

There is no implementation timeout and no tool-call cap. Runs continue until
completed, failed, or explicitly cancelled.

## Claim rule

The hypothesis is supported for an episode only when:

- every `mai-spec` repetition passes all applicable hard gates;
- MAI quality is equivalent to or better than `opus-raw` within the registered
  margin; and
- MAI has both lower median productive execution time and fewer median
  implementation tokens.

Quality, time, and token verdicts are reported separately. The weaker episode
determines overall status.

## Fail-closed evidence

Reports reject incomplete or duplicate matrices, mixed versions, selective
replacement, wrong model/lane assignment, raw Opus runs carrying spec content,
MAI spec-hash drift, prompt drift, and missing timing/token categories.
