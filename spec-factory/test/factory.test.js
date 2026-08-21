import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assembleSpec, loadBundle, renderSpecMarkdown, writeStage } from "../src/bundle.js";
import { cmdApprove } from "../src/cli.js";
import { hashBundle } from "../src/hashing.js";
import { scoreBundle } from "../src/scoring.js";
import { STAGES } from "../src/stages.js";
import { isApprovable, validateBundle } from "../src/validate.js";
import {
  approveSpecKitBundle,
  hashSpecKitBundle,
  loadSpecKitBundle,
  validateSpecKitBundle
} from "../src/spec-kit.js";

function approvedBundle() {
  return {
    intent: {
      problemStatement: "Preserve behavior while implementing the episode.",
      goals: ["Deliver the requested behavior"],
      nonGoals: ["Unrelated features"],
      successMetrics: ["All public and sealed checks pass"],
      stakeholders: ["Operations"]
    },
    discovery: {
      systemSummary: "A brownfield reconciliation application.",
      components: ["Application"],
      dataFlows: ["Input to output"],
      constraints: ["Preserve contracts"],
      knownBehaviors: ["Idempotent processing"]
    },
    ambiguities: {
      items: [
        {
          id: "AMB-1",
          severity: "low",
          description: "Storage detail",
          resolution: "Implementation choice",
          status: "resolved"
        }
      ]
    },
    requirements: {
      items: [
        { id: "REQ-1", statement: "Implement the requested behavior.", testable: true }
      ]
    },
    invariants: {
      items: [
        { id: "INV-1", statement: "Existing behavior remains stable.", enforcementPoint: "Tests" }
      ]
    },
    nfrs: {
      items: [
        { id: "NFR-1", category: "security", statement: "Avoid unsafe execution.", target: "No findings" }
      ]
    },
    risks: {
      items: [
        { id: "RISK-1", likelihood: "low", impact: "high", description: "Behavior drift", mitigation: "Characterization tests" }
      ]
    },
    acceptanceCriteria: {
      items: [
        {
          id: "AC-1",
          requirementId: "REQ-1",
          testable: true,
          given: "the baseline",
          when: "the implementation runs",
          then: "the requirement is satisfied"
        }
      ]
    },
    traceability: {
      links: [
        {
          requirementId: "REQ-1",
          acceptanceCriteriaIds: ["AC-1"],
          invariantIds: ["INV-1"],
          riskIds: ["RISK-1"]
        }
      ]
    },
    signoff: {
      reviewers: [
        { name: "Independent reviewer", role: "Technical reviewer", verdict: "approve" }
      ],
      decision: "approved",
      decidedAt: "2026-08-21T10:00:00.000Z",
      notes: "Approved for measured use.",
      authors: [
        { name: "Claude Opus 5", role: "Specification author" }
      ],
      blindnessAttestation: {
        attested: true,
        statement: "The author had no evaluator or prior-evidence access."
      },
      authoringEffort: {
        elapsedMinutes: 30,
        uncachedInputTokens: 1000,
        cachedInputTokens: 200,
        outputTokens: 500,
        reasoningTokens: 300,
        estimatedCostUsd: null,
        costEvidenceRef: null,
        costMethod: null
      }
    }
  };
}

function writeBundle(directory, bundle) {
  for (const stage of STAGES) {
    writeStage(directory, stage.id, bundle[stage.id]);
  }
}

test("a complete evaluator-blind bundle validates, scores, renders, and hashes deterministically", () => {
  const bundle = approvedBundle();
  assert.deepEqual(validateBundle(bundle), { errors: [], criticalBlocks: [] });
  assert.equal(isApprovable(bundle), true);
  assert.equal(scoreBundle(bundle).blocked, false);
  assert.match(hashBundle(assembleSpec(bundle, { id: "test-spec" })), /^[a-f0-9]{64}$/);
  assert.match(renderSpecMarkdown(bundle, { id: "test-spec" }), /Acceptance criteria/);
});

test("critical ambiguities, untestable requirements, and missing blindness fail closed", () => {
  const ambiguous = approvedBundle();
  ambiguous.ambiguities.items[0].severity = "critical";
  ambiguous.ambiguities.items[0].status = "open";
  assert.ok(validateBundle(ambiguous).criticalBlocks.length > 0);

  const untestable = approvedBundle();
  untestable.requirements.items[0].testable = false;
  assert.ok(validateBundle(untestable).criticalBlocks.length > 0);

  const sighted = approvedBundle();
  sighted.signoff.blindnessAttestation.attested = false;
  assert.ok(
    validateBundle(sighted).criticalBlocks.some((message) =>
      message.includes("blindnessAttestation")
    )
  );
});

test("approval writes a content-bound manifest with full token categories", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "spec-handoff-spec-"));
  try {
    writeBundle(directory, approvedBundle());
    assert.equal(cmdApprove(directory, { id: "test-approved" }), 0);
    const manifestPath = path.join(directory, "manifest.json");
    assert.equal(existsSync(manifestPath), true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
    assert.equal(manifest.blindnessAttestation.attested, true);
    assert.equal(manifest.authoringEffort.uncachedInputTokens, 1000);
    assert.equal(manifest.authoringEffort.cachedInputTokens, 200);
    assert.equal(manifest.authoringEffort.outputTokens, 500);
    assert.equal(manifest.authoringEffort.reasoningTokens, 300);
    assert.equal(
      manifest.sha256,
      hashBundle(assembleSpec(loadBundle(directory), { id: "test-approved" }))
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failed re-approval removes any stale manifest", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "spec-handoff-spec-"));
  try {
    const bundle = approvedBundle();
    writeBundle(directory, bundle);
    assert.equal(cmdApprove(directory, { id: "test-approved" }), 0);
    bundle.signoff.blindnessAttestation.attested = false;
    writeStage(directory, "signoff", bundle.signoff);
    assert.equal(cmdApprove(directory, { id: "test-approved" }), 1);
    assert.equal(existsSync(path.join(directory, "manifest.json")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function writeSpecKitBundle(directory, { unchecked = false } = {}) {
  const artifacts = {
    "constitution.md": "# Test Constitution\n\n## Core Principles\n\nBehavior first.\n\n## Governance\n\nReview required.",
    "spec.md": "# Feature Specification: Test\n\n## User Scenarios & Testing\n\n### User Story 1 - Deliver (Priority: P1)\n\n**Independent Test**: observable test\n\n## Requirements\n\n- **FR-001**: System MUST deliver.\n\n## Success Criteria\n\n- **SC-001**: Delivery is observable.\n\n## Clarifications\n\nAll resolved.",
    "plan.md": "# Implementation Plan: Test\n\n## Technical Context\n\n.NET 8\n\n## Constitution Check\n\nPASS\n\n## Project Structure\n\n```text\nsrc/\ntests/\n```",
    "tasks.md": "# Tasks: Test\n\n## Phase 1: Setup\n\n- [ ] T001 [US1] Add test in tests/Test.cs\n\n## Dependencies & Execution Order\n\nT001 first.",
    "analysis.md": "# Cross-Artifact Analysis: Test\n\n## Constitution Compliance\n\nPASS\n\n## Coverage\n\nFR-001 | US1 | T001 | Covered\n\n## Consistency Findings\n\nNone.\n\n## Unresolved Issues\n\nNone.\n\n## Recommendation\n\nReady.",
    "checklists/requirements.md": `# Requirements Quality Checklist: Test\n\n## Specification Quality\n\n- [x] CHK001 Complete\n\n## Plan and Task Quality\n\n- [${unchecked ? " " : "x"}] CHK002 Complete`
  };
  for (const [relativePath, content] of Object.entries(artifacts)) {
    const filePath = path.join(directory, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${content}\n`, "utf8");
  }
}

test("GitHub Spec Kit artifacts validate and hash deterministically", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "spec-kit-"));
  try {
    writeSpecKitBundle(directory);
    const bundle = loadSpecKitBundle(directory);
    assert.equal(validateSpecKitBundle(bundle).valid, true);
    const metadata = {
      id: "test-spec-kit",
      methodologyCommit: "5cf60225e989ee9c7d9ac789352838676a00181b"
    };
    assert.equal(
      hashSpecKitBundle(bundle, metadata),
      hashSpecKitBundle(bundle, metadata)
    );
    const manifest = approveSpecKitBundle(directory, {
      ...metadata,
      approvedAt: "2026-08-21T10:00:00Z",
      reviewer: "Independent reviewer",
      author: "Claude Opus 5",
      authoringEffort: {
        elapsedSeconds: 1800,
        uncachedInputTokens: 1000,
        cachedInputTokens: 100,
        outputTokens: 500,
        reasoningTokens: 200
      }
    });
    assert.equal(manifest.methodology.commit, metadata.methodologyCommit);
    assert.equal(manifest.authoringEffort.elapsedSeconds, 1800);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Spec Kit approval fails closed on unchecked requirements quality", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "spec-kit-"));
  try {
    writeSpecKitBundle(directory, { unchecked: true });
    assert.throws(
      () =>
        approveSpecKitBundle(directory, {
          id: "test-spec-kit",
          methodologyCommit: "5cf60225e989ee9c7d9ac789352838676a00181b",
          approvedAt: "2026-08-21T10:00:00Z",
          reviewer: "reviewer",
          author: "Claude Opus 5",
          authoringEffort: {}
        }),
      /unchecked items/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Spec Kit analysis must close the Unresolved Issues section itself", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "spec-kit-"));
  try {
    writeSpecKitBundle(directory);
    writeFileSync(
      path.join(directory, "analysis.md"),
      "# Cross-Artifact Analysis: Test\n\n## Constitution Compliance\n\nNone.\n\n## Coverage\n\nCovered.\n\n## Unresolved Issues\n\nCritical unresolved conflict.\n",
      "utf8"
    );
    const result = validateSpecKitBundle(loadSpecKitBundle(directory));
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((error) => error.includes("Unresolved Issues"))
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
