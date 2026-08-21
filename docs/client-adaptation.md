# Adapting the benchmark for a client

## Choose a representative slice

Select a bounded workload that contains real brownfield difficulty without requiring production data:

- Stable business behavior with known examples.
- Meaningful legacy constraints or unsupported dependencies.
- Existing production incidents, controls, or regression evidence that can be sanitized.
- A modernization or feature task that a delivery team can complete within a controlled time box.

Avoid selecting a toy application, a politically favored project, or a workload whose expected answer is already encoded in public tests.

## Establish client-owned evidence

Convert sanitized operational evidence into:

- Golden-master scenarios.
- Domain invariants.
- Failure and recovery cases.
- Security and control gates.
- Performance and operability thresholds.

Keep hidden checks independent from spec authors. Hidden requirements must be justifiable from the raw brief, baseline behavior, or client policy made available equally to all lanes.

## Configure the comparison

The default four lanes isolate model tier and specification quality. A client may substitute approved models, but must freeze:

- Exact model and agent build identifiers.
- Reasoning-effort settings.
- Tool permissions.
- Time and tool-call limits.
- Interleaved run order.
- Repetition count.
- Rate source and token categories.

Changing these after runs begin creates a new benchmark version.

## Treat the spec as an investment

Capture discovery, authoring, review, and approval effort. Show both:

- The cost of one delivery using the spec.
- The amortized cost when the same spec supports repeated runs, teams, releases, or assurance activities.

This prevents a spec-driven lane from appearing artificially cheap by excluding the work that made it effective.

## Interpret the result

Use the benchmark to answer a local operating-model question, not to rank all models universally:

- Where does specification quality reduce delivery risk?
- Which tasks can move to efficient models without losing controls?
- Which tasks still need frontier-model capability?
- What evidence should become a continuous delivery gate?
- How much specification investment is justified by reuse?

Retain inconclusive and negative outcomes. They are evidence about where the proposed delivery model does not yet work.
