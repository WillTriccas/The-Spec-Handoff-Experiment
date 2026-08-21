# Benchmark engine

The engine plans and enforces the `mai-spec` versus `opus-raw`, 12-cell
experiment with no implementation timeout.

```powershell
node bin/benchmark.js list-runs --randomized
node bin/benchmark.js prepare-authoring --episode modernization --out <dir>
node bin/benchmark.js prepare --run <run-id> --baseline <dir> --out <dir>
node bin/benchmark.js import --run-dir <dir> --execution <json>
node bin/benchmark.js score --evaluator <json> --episode-id <id>
node bin/benchmark.js report --runs <json> --data-kind measured --out <json> --freeze-record <json>
node bin/benchmark.js freeze --out <json>
```

`freeze` exits 2 while blocked. That is the expected repository state before
real Opus-authored specs and all four independent approvals exist.

Measured reports fail closed on incomplete, duplicate, mixed-version, unexpected,
selectively replaced, policy-drifted, or spec-hash-mismatched inputs.
