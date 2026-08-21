# The Spec Handoff Experiment

A controlled public benchmark comparing a **spec-driven handoff to MAI** with
**direct task execution by Opus**.

For each Financial Services episode, a fresh Claude Opus 5 session uses GitHub
Spec Kit methodology—constitution, specify, clarify, plan, checklist, tasks, and
analyze—to create an evaluator-blind implementation handoff. After independent
approval, the benchmark compares:

| Lane | Implementation model | Input |
|---|---|---|
| `mai-spec` | MAI Code 1.1 Flash | Task brief + immutable baseline + approved Opus-authored Spec Kit artifacts |
| `opus-raw` | Claude Opus 5 | Task brief + immutable baseline; no specification |

Three repetitions per episode/lane produce exactly **12 implementation cells**.
No measured authoring or implementation sessions have run; every evidence and
dashboard status is `not-evaluated`.

## Episodes

1. Modernize the legacy .NET Framework trade-reconciliation batch application to
   .NET 8 while preserving characterized behavior.
2. Add explainable maker-checker resolution and append-only audit history to the
   canonical .NET 8 application.

Runs have **no timeout or tool-call cap**. The primary comparisons are sealed
output quality score, productive execution time, and implementation token usage.
Wall-clock time, queue/throttle time, and amortized authoring time/tokens remain
separate secondary context.

The workloads, public fixtures, adapters, spec factory, and sealed evaluator were
surgically ported from
[`WillTriccas/The-Spec-Advantage-Demo`](https://github.com/WillTriccas/The-Spec-Advantage-Demo)
at exact commit `05547458aeb09d651237fa521459d742e1d36e85`.
Prior measured evidence, transcripts, bundles, patches, generated output, build
artifacts, dependencies, and Git history were excluded.

## Validate

On Windows with Node.js 20.19+ and the .NET 8 SDK:

```powershell
npm ci
npm run validate
```

The command runs JavaScript checks/tests/builds, framework and freeze assertions,
an independent fetch/hash verification of the exact public source commit, both
.NET baseline suites, sealed fixture validation, and single-file dashboard
bundling.

## Start here

- [Experiment protocol](docs/experiment-protocol.md)
- [Independence boundaries](docs/independence-boundaries.md)
- [Operating guide](docs/operating-guide.md)
- [Measured-run procedure](docs/measured-run-procedure.md)
- [Client narrative](docs/client-narrative.md)
- [Limitations](docs/limitations.md)
- [Source provenance](docs/source-provenance.md)
