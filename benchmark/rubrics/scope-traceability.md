# `scopeTraceability` scoring rubric

Applies to the `scopeTraceability` dimension in `benchmark/config/scoring.json`,
scored by a blind (`attestation.independentFromSpecAuthors === true`) evaluator
against every run — spec lane and raw lane alike. Per contract correction item
10, raw lanes must be **equally gradeable** on this dimension, not merely
penalized to 0 for lacking the artifact (a traceability matrix) that only the
spec lane produces.

## Why this exists

Before this rubric, it would have been easy for an evaluator to score
`scopeTraceability` as "does the deliverable cite requirement IDs in a
traceability matrix?" — which raw-lane runs can *never* satisfy, since raw
lanes receive only a task brief and produce no such artifact. That would make
`scopeTraceability` a spec-lane-only dimension in practice, silently biasing
the weighted `qualityScore` in favor of spec lanes regardless of whether the
raw-lane delivery actually addressed the same underlying scope. This rubric
defines what "good scope traceability" looks like for *both* input modes so
the dimension measures the same underlying thing — full, accurate coverage of
the required scope — however that coverage is evidenced.

## What to score, per input mode

### Spec lane (`inputMode: "spec"`)

Score based on the delivered change's fidelity to the approved spec bundle's
requirements, domain invariants, NFRs, and acceptance criteria, as cited via
explicit traceability IDs (e.g. `REQ-3`, `INV-2`, `AC-5`):

- **100**: every requirement/invariant/NFR/acceptance criterion in the spec
  is addressed by the delivered change, and the mapping is explicit and
  verifiable (e.g. a traceability table, commit messages/PR description
  citing IDs, or code comments referencing IDs).
- **60–90**: most requirements are addressed and traceable, but some
  citations are missing, some minor requirement is unaddressed, or the
  mapping requires some inference to verify.
- **1–59**: significant gaps — several requirements are unaddressed, or the
  traceability mapping is too sparse/inconsistent to verify coverage
  without substantial guesswork.
- **0**: no discernible attempt to address or map to the spec's scope (this
  should be rare and should prompt double-checking that the evaluator
  actually reviewed the spec, not just the diff).

### Raw lane (`inputMode: "raw"`)

Raw lanes never receive a spec bundle, so they cannot cite spec traceability
IDs — but they can still be graded on **inferred requirement coverage**: does
the delivered change address the same underlying scope a competent reading of
the task brief implies, even without explicit ID citations?

To score a raw-lane run's `scopeTraceability`:

1. Read the same task brief this run received (`taskBrief` on the run
   descriptor / `benchmark/prompts/`), and independently identify the
   underlying requirements/invariants/NFRs/edge cases a thorough
   implementation would need to address — this is the evaluator's own
   "shadow requirement list," not derived from the spec bundle (the
   evaluator should remain blind to the spec bundle's exact wording when
   scoring a raw-lane run, to keep the comparison fair).
2. Check the delivered change against that shadow list: does it cover the
   same ground, even if described in its own words / commit messages / PR
   description, without explicit ID citations?
3. Score using the same 0/1–59/60–90/100 bands as the spec lane above, but
   substitute "shadow requirement list coverage" for "spec ID citation
   coverage" as the measure of traceability. A raw-lane run that covers the
   same substantive scope as a spec-lane run, just without formal ID
   citations, should score comparably — **not** near 0 merely for lacking
   an artifact the raw lane was never given the tools to produce.

## Guardrails

- A `scopeTraceability` score of exactly `0` on a raw-lane run is flagged by
  `benchmark/src/scoring.js` as a non-blocking warning pointing back to this
  document, precisely because a lazy "no traceability IDs → 0" scoring
  shortcut is the failure mode this rubric exists to prevent. A `0` is only
  correct if the delivered change plainly fails to address the brief's scope
  at all — re-check against step 1–3 above before accepting it.
- This rubric does not change the dimension's *weight* in
  `scoring.json` — it only defines what evidence justifies each score, for
  both input modes equally.
