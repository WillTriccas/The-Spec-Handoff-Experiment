import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assembleSpec, loadBundle, renderSpecMarkdown, writeStage } from "../src/bundle.js";
import { cmdApprove } from "../src/cli.js";
import { hashBundle } from "../src/hashing.js";
import { scoreBundle } from "../src/scoring.js";
import { STAGES } from "../src/stages.js";
import { isApprovable, validateBundle } from "../src/validate.js";

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
