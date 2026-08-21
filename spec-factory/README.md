# Spec factory

A guided, CLI-driven workflow for turning an ambiguous task into an approved,
hashed, quality-scored specification bundle — and a set of fully worked
example bundles used as the "spec" input to the benchmark engine in
`../benchmark/`.

## Why this exists

The benchmark compares agent output quality/efficiency when given a raw task
brief versus an approved spec. For that comparison to mean anything, spec
authoring has to be a real, auditable process — not just a nicer prompt.
This factory enforces that:

- every stage of the workflow is captured as a separate, reviewable file;
- ambiguities are explicit and critical ones **block approval** until
  resolved;
- every requirement and acceptance criterion must be marked testable, or
  approval is blocked;
- an approved bundle is hashed (sha256) so downstream consumers (the
  benchmark) can prove which exact spec version an agent received.

## Workflow stages

Run `node bin/spec-factory.js stages` to list them, in the order they should
be authored:

1. **intent** — problem statement, goals, non-goals, success metrics, stakeholders.
2. **discovery** — brownfield facts imported from the existing system: components, data flows, constraints, known behaviors to preserve.
3. **ambiguities** — every open question raised during framing/discovery, its severity, and how it was resolved. **Unresolved `critical` ambiguities block approval.**
4. **requirements** — testable functional requirements. **Any requirement with `testable: false` blocks approval.**
5. **invariants** — domain rules that must always hold, with their enforcement point.
6. **nfrs** — non-functional requirements (performance, security, maintainability, operability, observability).
7. **risks** — risks with likelihood, impact and mitigation.
8. **acceptanceCriteria** — Given/When/Then scenarios tied to requirements. **Untestable acceptance criteria block approval.**
9. **traceability** — links from requirement → acceptance criteria / invariants / risks. Every requirement must have at least one link with at least one acceptance criterion, or the bundle is structurally invalid.
10. **signoff** — reviewer roster and an explicit `approved`/`rejected` decision, plus (per an independent design-review correction) the spec-authoring record required to keep the benchmark's raw-vs-spec comparison valid: `authors` (distinct from the benchmark's hidden evaluator team), a `blindnessAttestation` (`attested: true` required — the authors must confirm they had no access to the hidden evaluator rubric, evaluator JSON schema, or scoring weights while authoring), and `authoringEffort` (`elapsedMinutes`/`inputTokens`/`outputTokens`/`estimatedCostUsd`, so the benchmark can amortize the one-time authoring cost across the spec's repeated reuse — see `benchmark/README.md`'s cost/efficiency correction).

## CLI usage

```sh
node bin/spec-factory.js init <dir>       # scaffold blank stage templates
node bin/spec-factory.js validate <dir>   # structural + critical-block check
node bin/spec-factory.js score <dir>      # weighted 0-100 quality score
node bin/spec-factory.js approve <dir> --id <spec-id>
                                           # validate + score, then write manifest.json
                                           # (sha256, qualityScore, approvedAt) if approvable
node bin/spec-factory.js hash <dir> --id <spec-id>
                                           # print the sha256 of the assembled bundle
node bin/spec-factory.js render <dir> --title "My Spec"
                                           # render the assembled bundle to Markdown
```

`approve` refuses (exit code 1, no `manifest.json` written) when:

- any stage file is missing or missing a required field,
- any requirement has an unresolved traceability gap,
- any `critical` ambiguity is not `resolved`,
- any requirement or acceptance criterion is marked `testable: false`,
- `signoff.decision` is not `"approved"`,
- `signoff.blindnessAttestation.attested` is not exactly `true` — an
  unattested (or explicitly `false`) attestation is a critical block, not a
  missing-field warning, since a spec authored with sight of the hidden
  evaluator rubric would invalidate the benchmark's raw-vs-spec comparison.

`manifest.json` (written by `approve`) records the bundle's sha256 hash,
quality score, and approval timestamp — the downstream benchmark's
`provenance.json` cites this hash so any measured run can be traced back to
the exact spec text an agent received.

## Quality scoring

`scoreBundle()` (see `src/scoring.js`) computes a weighted 0-100 score across
five dimensions: completeness, clarity (ambiguity resolution rate),
testability, traceability coverage, and risk coverage. A bundle that fails
the structural or critical-block checks always scores `0` and is marked
`blocked: true`, regardless of how complete its other stages are — the score
is a *quality* signal for an already-valid bundle, not a way to average away
a blocking defect.

This is distinct from the benchmark's own run-quality scoring
(`benchmark/config/scoring.json`), which scores the *output* of a coding
agent against functional correctness, behavior preservation, security,
maintainability, operability and scope/traceability — not the spec itself.

## Examples

`examples/modernization/approved/` and `examples/audit-feature/approved/`
are fully worked, approved bundles consistent with:

- **modernization**: porting a legacy .NET Framework 4.8 C# trade
  reconciliation console app (`TradeReconciler.exe`, MSMQ + WCF input,
  file-based output) to .NET 8 with preserved behavior.
- **audit-feature**: adding reason codes/evidence, maker-checker approval
  separation, append-only audit history, idempotency/concurrency handling,
  a Compliance export, and telemetry with no sensitive data in logs, on top
  of the modernized service.

Both include a committed `manifest.json` (sha256 + quality score) produced
by `approve`, and both are referenced by `benchmark/config/experiment.json`
as the `specBundle` for their respective episode.

Raw task briefs for the same two scenarios — deliberately less detailed than
these approved specs, since that gap is what the benchmark measures — live
separately in `../benchmark/prompts/` and are never placed in this
directory. Raw benchmark lanes only ever receive those briefs; the benchmark
engine's workspace preparation step (`benchmark/src/prepare.js`) asserts that
no spec-bundle file is ever copied into a `raw` lane's workspace.
