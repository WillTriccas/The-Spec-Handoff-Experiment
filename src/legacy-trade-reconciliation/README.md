# Legacy trade reconciliation

This subtree contains a synthetic .NET Framework 4.6.2-style batch reconciliation workload for the AI-enabled SDLC benchmark. It is intentionally brownfield: old-style project files, static configuration, synchronous CSV file access, weak boundaries between parsing/matching/reporting, and only a couple of public characterization tests.

## Layout

| Path | Purpose |
| --- | --- |
| `LegacyTradeReconciliation\` | Batch application and sample data |
| `tests\LegacyTradeReconciliation.CharacterizationTests\` | Public golden-master characterization tests and deterministic fixtures |
| `LegacyTradeReconciliation.sln` | Visual Studio solution for the subtree |
| `benchmark-adapter.json` | Stable, data-only build/test/run contract for the external evaluator |

## Build

The projects are old-style `.csproj` files, but they use a single `PackageReference` for the .NET Framework 4.6.2 reference assemblies so they can usually restore with a modern CLI without installing a machine-wide targeting pack.

```powershell
dotnet msbuild .\src\legacy-trade-reconciliation\LegacyTradeReconciliation.sln /t:Restore,Build /p:Configuration=Release
```

## Run

Run the synthetic sample batch:

```powershell
.\src\legacy-trade-reconciliation\LegacyTradeReconciliation\bin\Release\LegacyTradeReconciliation.exe
```

Or pass an explicit business date, input folder, and output folder:

```powershell
.\src\legacy-trade-reconciliation\LegacyTradeReconciliation\bin\Release\LegacyTradeReconciliation.exe `
  2025-03-17 `
  .\src\legacy-trade-reconciliation\LegacyTradeReconciliation\data\sample `
  .\src\legacy-trade-reconciliation\scratch\sample-output
```

The batch writes:

- `matched-trades.csv`
- `break-queue.csv`
- `end-of-day-report.txt`
- `run-ledger.csv`

## Characterization tests

```powershell
.\src\legacy-trade-reconciliation\tests\LegacyTradeReconciliation.CharacterizationTests\bin\Release\LegacyTradeReconciliation.CharacterizationTests.exe
```

The tests lock in deterministic golden-master behavior for:

1. The baseline break queue and end-of-day report.
2. Manual override handling plus exact-input idempotent reruns.

## Business invariants

The workload codifies several domain rules that a modernization effort would need to preserve:

1. Account, instrument, and currency are compared on trimmed uppercase values.
2. The first occurrence of a trade identifier is canonical; later duplicates always go to the break queue.
3. Position and settlement candidates must agree on account, instrument, settlement date, and currency before tolerance checks are evaluated.
4. Quantity matching uses separate tolerances for positions and settlements; settlement cash amount uses its own tolerance.
5. Non-positive trade quantities and net amounts are always breaks even if counterpart records exist.
6. Manual overrides may only resolve breaks that already have concrete counterpart candidates; they cannot manufacture missing records.
7. Suppressed breaks leave an audit trail in `matched-trades.csv` instead of disappearing silently.
8. Exact-input reruns for the same business date are idempotent: outputs are not duplicated and the ledger does not gain duplicate entries.
9. If more than one manual override targets a trade, only the first is applied and every later instruction is surfaced as a stale override rather than discarded.

All fixture data is synthetic and intentionally unrealistic enough to avoid any production or customer sensitivity.

Modernization agents may change the commands in `benchmark-adapter.json` as the toolchain changes, but must preserve its schema and the observable CLI/output contract.
