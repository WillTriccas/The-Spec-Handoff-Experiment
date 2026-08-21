# Architecture

| Area | Responsibility |
|---|---|
| `src/` | Immutable baseline workloads, public tests, fixtures, and adapters |
| `authoring/` | Evaluator-blind prompts, one plan per episode, and future authoring evidence |
| `spec-factory/` | Guided spec stages, validation, quality scoring, rendering, hashing, and content-bound approval |
| `specs/` | Empty approved-spec locations until real authoring and review occur |
| `benchmark/` | Matrix planning, isolated workspace preparation, import, scoring, aggregation, claims, and freeze readiness |
| `contracts/` | Versioned authoring, run, report, candidate-adapter, and audit-adapter schemas |
| `evaluator/` | Sealed hidden-fixture generation, security checks, episode evaluation, and hard gates |
| `evidence/test-runs/` | Versioned manifests, summaries, views, reports, and canonical run links |
| `dashboard/` | Single-file executive and engineering views; currently pre-measurement |

The authoring workspace materializer copies only the selected baseline, the
episode authoring prompt, blank spec templates, and a workspace manifest. The
implementation workspace materializer reads the approved manifest, verifies its
assembled SHA-256, and renders the same spec for both lanes.

Freeze readiness hashes the baselines, prompts, authoring plans/evidence, approved
spec manifests/content, evaluator, scoring, contracts, benchmark engine, model
pins, and execution policy. Measured import/reporting requires a ready self-hashed
freeze record.
