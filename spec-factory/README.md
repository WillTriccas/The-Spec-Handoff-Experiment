# Spec factory

A guided CLI workflow for producing one approved, content-addressed
specification per episode.

The ten stages cover intent, brownfield discovery, ambiguities, requirements,
invariants, non-functional requirements, risks, acceptance criteria,
traceability, and sign-off. Approval fails when critical ambiguities remain,
requirements or acceptance criteria are untestable, traceability is incomplete,
the human decision is not approved, or evaluator blindness is not attested.

```powershell
node bin/spec-factory.js init <dir>
node bin/spec-factory.js validate <dir>
node bin/spec-factory.js score <dir>
node bin/spec-factory.js approve <dir> --id <spec-id>
node bin/spec-factory.js hash <dir> --id <spec-id>
node bin/spec-factory.js render <dir> --title "<title>"
```

`approve` writes `manifest.json` with the SHA-256 of the assembled spec, quality
score, approval metadata, author identities, blindness attestation, and authoring
effort. Authoring effort separates uncached input, cached input, output, and
reasoning tokens. Monetary cost stays null unless independently sourced.

No worked or approved example bundle is included in this repository. Real
Claude Opus 5 authoring sessions must populate `../specs/<episode>/approved/`.
