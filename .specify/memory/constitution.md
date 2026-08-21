# Spec Handoff Experiment Constitution

## Core Principles

### I. Behavior Preservation Is Non-Negotiable
Existing externally observable behavior, public contracts, fixtures, and
characterized business invariants must be preserved unless the task explicitly
changes them.

### II. Security and Financial Controls Fail Closed
No critical security finding is acceptable. Maker-checker separation,
idempotency, audit integrity, sensitive-data controls, and deterministic outcomes
must be specified as testable requirements where applicable.

### III. Independent, Testable User Stories
The specification must prioritize independently testable user scenarios.
Requirements and acceptance scenarios must identify observable outcomes without
encoding hidden evaluator details.

### IV. Contract-First Brownfield Delivery
Existing adapters and external interfaces are authoritative. Technical plans must
identify contract tests, integration tests, and migration constraints before
implementation tasks.

### V. Simplicity, Traceability, and Operability
Prefer the simplest design satisfying the task. Every implementation task must
trace to a requirement or user story, and the plan must address testing,
diagnostics, deterministic operation, and failure handling.

## Specification Constraints

- The author remains blind to sealed evaluator source, hidden fixtures, scoring
  weights, prior evidence, expected outcomes, and implementation transcripts.
- `spec.md` describes what and why in technology-agnostic terms.
- `plan.md` describes the technical approach and must pass this constitution
  before and after design.
- `tasks.md` contains atomic tasks with concrete file paths and user-story
  traceability.
- `analysis.md` closes cross-artifact consistency and coverage findings before
  approval.
- Unresolved critical clarifications, placeholder text, and unchecked
  requirements-quality checklist items block approval.

## Development Workflow

The required GitHub Spec Kit sequence is: constitution, specify, clarify, plan,
requirements checklist, tasks, and analyze. Implementation is deliberately
performed later by MAI Code 1.1 Flash in a fresh conversation.

## Governance

This constitution governs both Financial Services specifications. Amendments
require a version change and independent approval before measured authoring.
Approved artifacts are content-addressed and immutable for all three MAI
repetitions.

**Version**: 1.0.0 | **Ratified**: 2026-08-21 | **Last Amended**: 2026-08-21
