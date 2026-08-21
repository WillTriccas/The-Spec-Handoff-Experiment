# Task: Add explainable exception resolution and audit history

Extend the checked-in .NET 8 reconciliation baseline so an analyst can propose a
resolution for a reconciliation break with a reason and evidence, a different
person can approve or reject it, and Compliance can export an append-only history
for a date range. Self-approval must be prevented. Retries must be idempotent,
conflicting concurrent decisions must produce exactly one durable final decision,
and account identifiers or trade amounts must not leak into logs, command output,
or the audit export.

Preserve the existing reconciliation behavior and its `benchmark-adapter.json`.
Add a candidate-root `audit-adapter.json` that validates against
`contracts/audit-adapter.schema.json`. Its shell-free command arrays must implement:

- `initialize` using `{stateDirectory}`;
- `propose` using `{stateDirectory}`, `{requestId}`, `{proposer}`, `{businessDate}`,
  `{reason}`, and `{evidence}`;
- `decide` using `{stateDirectory}`, `{requestId}`, `{approver}`, and `{decision}`;
- `export` using `{stateDirectory}`, `{fromDate}`, `{toDate}`, and `{exportPath}`.

Commands must return parseable JSON on stdout; `export` may instead write JSON to
`{exportPath}`. The exported value must be an array or an object with an `entries`
array. Each durable entry must expose the request identity, lifecycle action,
recognized proposer or checker identity, and tamper-evidence/order metadata such
as a timestamp, sequence, version, or hash. The history must prove that an approved
or rejected request has one final decision by a checker distinct from its proposer.

Use your judgment on the internal design and persistence approach.
