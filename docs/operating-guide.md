# Operating guide

## 1. Validate the framework

Run `npm ci` and `npm run validate`. The freeze command is expected to exit 2
while real specifications and independent approvals are absent.

## 2. Run specification authoring

For each episode, prepare a clean authoring workspace:

```powershell
node benchmark/bin/benchmark.js prepare-authoring --episode modernization --out <authoring-root>
node benchmark/bin/benchmark.js prepare-authoring --episode audit-feature --out <authoring-root>
```

Start a fresh Claude Opus 5 conversation at high reasoning effort. Supply only
the workspace contents. Capture timestamps, agent/model metadata, transcript
reference/hash, prompt hash, baseline hash, and four token categories in the
versioned authoring-evidence contract.

## 3. Review and approve

An independent human reviews the spec-factory bundle. Do not approve unresolved
critical ambiguities or untestable requirements/acceptance criteria. After
sign-off, run:

```powershell
node spec-factory/bin/spec-factory.js validate specs/<episode>/approved
node spec-factory/bin/spec-factory.js approve specs/<episode>/approved --id <episode>-opus-approved-v1
```

Bind the resulting content SHA-256 and manifest SHA-256 into the authoring
evidence. Record scenario, specification, evaluator/scoring, and claim-rule
approvals in `benchmark/config/approvals.json`.

## 4. Freeze

Commit all frozen inputs, ensure the worktree is clean, then run:

```powershell
node benchmark/bin/benchmark.js freeze --out <freeze-record.json>
```

Proceed only when `ready` is true and blockers are empty.

## 5. Execute and report

Follow the deterministic order from
`node benchmark/bin/benchmark.js list-runs --randomized`. Do not regroup by model
or episode. Retain every terminal state and write each cell under its canonical
versioned evidence path. Import and publish only the full 12-cell set.
