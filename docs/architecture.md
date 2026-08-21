# Architecture

| Area | Responsibility |
|---|---|
| `src/` | Immutable baseline workloads, public tests, fixtures, and adapters |
| `authoring/` | Evaluator-blind prompts, one plan per episode, and future authoring evidence |
| `spec-factory/` | Guided spec stages, validation, quality scoring, rendering, hashing, and content-bound approval |
| `specs/` | Empty approved-spec locations until real authoring and review occur |
| `benchmark/` | Matrix planning, isolated workspace preparation, import, scoring, aggregation, claims, and freeze readiness |
| `contracts/` | Versioned authoring, run, report, candidate-adapter, and audit-adapter schemas |
| `evaluator/` | Sealed episode-specific fixture generation, evaluator-owned override harness, security checks, episode evaluation, and hard gates |
| `evidence/test-runs/` | Versioned manifests, summaries, views, reports, and canonical run links |
| `dashboard/` | Single-file executive and engineering views; currently pre-measurement |

The authoring workspace materializer copies only the selected baseline, the
episode prompt, the pinned constitution and Spec Kit templates, and a workspace
manifest. It produces constitution/spec/plan/checklist/tasks artifacts. The
implementation workspace materializer validates their manifest and renders them
only for `mai-spec`; `opus-raw` never reads or receives the spec directory.

Freeze readiness hashes the baselines, prompts, authoring plans/evidence, approved
spec manifests/content, evaluator, scoring, contracts, benchmark engine, model
pins, and execution policy. Measured import/reporting requires a ready self-hashed
freeze record.

The audit evaluator never feeds the legacy fixture to the canonical application.
It uses a separate PascalCase CSV fixture and checks the canonical JSON report.
Because the canonical CLI intentionally has no override-seeding option, a sealed
.NET harness references each candidate's application services directly, seeds the
real in-memory override store, and proves suppression and rerun idempotency.
