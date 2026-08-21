# The Spec Handoff Experiment

A controlled public benchmark isolating **implementation-model choice** while
holding specification authorship constant.

For each of two Financial Services episodes, a fresh Claude Opus 5 session will
author one evaluator-blind specification. After independent human approval, that
exact content-addressed spec is frozen and handed to fresh implementation
sessions:

| Lane | Implementation model | Input |
|---|---|---|
| `opus-spec` | Claude Opus 5 | Task brief + immutable baseline + approved spec |
| `mai-spec` | MAI Code 1.1 Flash | The identical task brief, baseline, and spec |

Three repetitions per episode/lane produce exactly **12 implementation cells**.
No measured authoring or implementation sessions have run; every evidence and
dashboard status is `not-evaluated`.

## Episodes

1. Modernize the legacy .NET Framework trade-reconciliation batch application to
   .NET 8 while preserving characterized behavior.
2. Add explainable maker-checker resolution and append-only audit history to the
   canonical .NET 8 application.

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
both .NET baseline suites, sealed fixture validation, and single-file dashboard
bundling.

## Start here

- [Experiment protocol](docs/experiment-protocol.md)
- [Independence boundaries](docs/independence-boundaries.md)
- [Operating guide](docs/operating-guide.md)
- [Measured-run procedure](docs/measured-run-procedure.md)
- [Client narrative](docs/client-narrative.md)
- [Limitations](docs/limitations.md)
- [Source provenance](docs/source-provenance.md)
