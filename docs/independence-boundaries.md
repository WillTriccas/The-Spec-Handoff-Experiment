# Independence boundaries

## Specification authors

May access the episode task brief, tagged baseline, public tests/fixtures, and
blank spec-factory templates. They may not access evaluator source, hidden
fixtures, scoring weights, run/report schemas, prior evidence, expected results,
approved specs from another episode, or implementation transcripts.

## Implementers

Receive only the task brief, tagged baseline, and approved spec artifact. Each
cell uses a fresh isolated workspace and conversation. No authoring transcript,
cross-run memory, or human remediation is allowed.

## Evaluator

The evaluator is sealed from authors and implementers. It uses generated hidden
synthetic fixtures, adapter-only interaction, pinned static security rules, and
episode hard gates. Its independence attestation must remain true.

## Reviewers

Specification approval and evaluator/scoring approval are independently recorded.
Freeze also requires explicit scenario and claim-adjudication approvals. Missing
or incomplete approvals block measured preparation/import.
