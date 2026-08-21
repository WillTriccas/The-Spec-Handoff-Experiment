# Sealed evaluator

This directory contains the sealed Node 20+ evaluator for both AI-enabled SDLC benchmark episodes. It owns hidden synthetic fixtures, validates candidate adapters, executes only executable/argument arrays with `shell: false`, and writes deterministic JSON evidence for the benchmark scorer.

## Usage

```powershell
node evaluator\bin\evaluate.js evaluate --candidate <candidate-dir> --episode modernization --evidence <evidence.json> --dotnet <path-to-dotnet>
node evaluator\bin\evaluate.js evaluate --candidate <candidate-dir> --episode audit-feature --evidence <evidence.json> --dotnet <path-to-dotnet>
node evaluator\bin\evaluate.js fixture-hashes
```

`--dotnet` is optional when `dotnet` is on `PATH`. Relative adapter executables are resolved inside the adapter working directory; only `dotnet` may be resolved from `PATH`. The evaluator never executes shell strings.

## Adapter files

Modernization candidates must provide `benchmark-adapter.json` matching `contracts/candidate-adapter.schema.json`. The evaluator substitutes `{businessDate}`, `{inputDirectory}`, and `{outputDirectory}` into command arguments and evaluates the declared output files.

Audit-feature candidates must provide both `benchmark-adapter.json` matching `contracts/candidate-adapter.schema.json` and `audit-adapter.json` matching `contracts/audit-adapter.schema.json`. The evaluator runs the benchmark adapter's real build and test commands, then runs one evaluator-owned reconciliation fixture through the benchmark adapter before exercising audit commands. Audit commands should support these placeholders in arguments: `{stateDirectory}`, `{requestId}`, `{proposer}`, `{approver}`, `{otherApprover}`, `{decision}`, `{businessDate}`, `{fromDate}`, `{toDate}`, `{exportPath}`, `{reason}`, `{evidence}`, `{accountSentinel}`, and `{amountSentinel}`. `propose`, `decide`, and `export` should return parseable JSON on stdout or, for export, write JSON to `{exportPath}`.

## Evidence and gates

Evidence is emitted with schema `sealed-evaluator-evidence/1.0.0`. Modernization gates are `build`, `essential-business-invariants`, and `no-critical-security-findings`. Audit-feature adds `maker-checker-separation` and `audit-integrity`.

Static checks are pinned pattern scans for common committed secrets, unsafe deserialization/process-execution patterns, and dependency vulnerability output where supported manifests exist. Critical static findings and high/critical dependency findings fail `no-critical-security-findings`. These checks are evidence signals only and are not a security certification.

Timeouts terminate the spawned adapter process tree using executable/argument process APIs (`taskkill.exe /pid ... /t /f` on Windows, process-group `SIGKILL` on Unix). The evaluator still never executes shell strings.

## Blindness attestation

Sources used: `contracts/candidate-adapter.schema.json`, `contracts/audit-adapter.schema.json`, `benchmark/prompts/*-raw.md`, `benchmark/config/scoring.json`, `src/legacy-trade-reconciliation/**`, and `src/canonical-modernized/**`.

I remained blind to `spec-factory/`, `evidence/`, approved spec content, and expected measured benchmark output. Hidden evaluator fixtures and expected checks were authored only from the allowed public sources above.
