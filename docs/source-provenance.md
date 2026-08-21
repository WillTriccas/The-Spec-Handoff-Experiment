# Source provenance

Reusable tracked assets were ported from
`https://github.com/WillTriccas/The-Spec-Advantage-Demo` at exact commit:

`05547458aeb09d651237fa521459d742e1d36e85`

The immutable baseline tags in this repository point to commit
`5428bd2902e8f4c2027274a64a38651d459a676e`:

| Tag | Path | Content SHA-256 |
|---|---|---|
| `baseline-legacy-trade-reconciliation-v1` | `src/legacy-trade-reconciliation` | `209c028929088c1695b9f00b4d10f3dd8c0e3217f9d41122301358f5927158a2` |
| `baseline-canonical-modernized-v1` | `src/canonical-modernized` | `82ff4d70d1423d45cb25e2d714355500d22b31eb6c8f47c5f5f246d4f4662120` |

The hashes match the corresponding directories at the source commit. See
`provenance/source.json` and `provenance/baselines.json`.

`npm run validate:source-provenance` independently clones the public source
repository, fetches the exact pinned commit, deterministically hashes the tracked
files under both workload paths, and compares those hashes with the committed
provenance record. This network-backed check runs in the complete validation and
CI; `npm run validate:framework` retains offline checks against this repository's
immutable baseline tags.

Excluded: prior measured evidence, run transcripts, source bundles/patches,
generated dashboard output, `node_modules`, `bin`, `obj`, and source Git history.

The specification workflow is adapted from GitHub Spec Kit at commit
`5cf60225e989ee9c7d9ac789352838676a00181b`. Upstream template blob hashes and
the adaptation boundary are recorded in `provenance/spec-kit.json`.
