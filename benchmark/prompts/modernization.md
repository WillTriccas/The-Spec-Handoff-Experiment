# Task: Modernize the trade reconciliation app

Modernize the checked-in `LegacyTradeReconciliation.exe` batch application from
.NET Framework 4.6.2 to .NET 8. Preserve its externally observable reconciliation
behavior, command-line inputs, synthetic CSV input formats, and four output files:
`matched-trades.csv`, `break-queue.csv`, `end-of-day-report.txt`, and
`run-ledger.csv`.

The application accepts a business date, input directory, and output directory.
It ingests trades, positions, settlements, and manual overrides from CSV files.
Trade Operations depends on the current matching, tolerance, override, duplicate,
and idempotent-rerun behavior, including stable output schemas.

Improve the design, testability, security posture, and operability where practical,
and add meaningful automated tests. Do not add unrelated product features.

Keep a candidate-root `benchmark-adapter.json` that validates against
`contracts/candidate-adapter.schema.json`. The adapter must expose shell-free
build, test, and run command arrays; use the `{businessDate}`, `{inputDirectory}`,
and `{outputDirectory}` placeholders; and declare every output file. External
evaluation will interact with the candidate only through that adapter and the
observable files it produces.
