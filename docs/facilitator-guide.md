# Facilitator guide

## Audience

The primary audience is an engineering director, transformation lead, architecture leader, or technology risk stakeholder evaluating AI-enabled delivery in a large brownfield estate.

## Core message

The demonstration is not that a small model is always better. It shows that specification quality is an engineering control that can raise output quality, reduce model dependence, and make AI-assisted delivery measurable and reviewable.

## Fifteen-minute flow

### 1. Establish the brownfield reality

Open the legacy trade-reconciliation application. Highlight old project conventions, monolithic orchestration, static configuration, synchronous integration, sparse tests, and embedded domain rules.

Emphasize that the data is synthetic but the failure patterns are representative of modernization work.

### 2. Show the spec factory

Move from intent to brownfield discovery, ambiguity review, requirements, NFRs, risks, acceptance evidence, and sign-off.

Use one unresolved critical ambiguity to show that the quality gate blocks an apparently complete but unsafe specification.

### 3. Explain the controlled experiment

Show the four lanes and exact models. Explain why three repetitions and independent baselines are needed. Call out that raw lanes cannot see the approved spec and no lane can see the hidden evaluator.

### 4. Present the executive evidence

Start with claim status, hard gates, median quality, range, and elapsed or cost comparison. Explain missing cost as unavailable rather than treating it as free.

If the result is inconclusive or not supported, treat that as useful governance evidence rather than a failed demo.

### 5. Drill into engineering evidence

Select a run and trace a requirement through implementation, hidden tests, control checks, and score calculation. Compare this with a raw run that inferred or missed the same requirement.

### 6. Close on operating model

Position specs as reusable delivery assets:

- They make requirements testable before code generation.
- They expose ambiguity and risk early.
- They make model choice an economic decision rather than a leap of faith.
- They provide evidence for review, assurance, and continuous improvement.

## Thirty-minute extension

Add:

- A live workspace preparation.
- A walkthrough of the raw and spec prompt bundles.
- A failed run and its retained evidence.
- Spec-quality scoring details.
- Benchmark limitations and how a client would substitute its own scenario.

## Statements to avoid

- Do not claim universal superiority from this scenario.
- Do not present illustrative evidence as measured.
- Do not equate an audit-control demo with regulatory certification.
- Do not call unknown model cost zero.
- Do not hide failed runs or variability.
- Do not imply that a specification removes the need for engineering review.

## Client adaptation discussion

Ask the client to identify:

- A representative but non-sensitive brownfield slice.
- Stable business invariants and existing production evidence.
- An expensive or risky delivery task.
- Existing quality, security, and control gates.
- Model access, data-boundary, and audit requirements.

The same four-lane design can then test the value of specification investment in that environment.

