import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBundle } from "../src/bundle.js";
import { validateBundle, isApprovable } from "../src/validate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODERNIZATION_DIR = path.join(__dirname, "..", "examples", "modernization", "approved");
const AUDIT_FEATURE_DIR = path.join(__dirname, "..", "examples", "audit-feature", "approved");

test("the modernization approved example bundle is structurally valid and approvable", () => {
  const bundle = loadBundle(MODERNIZATION_DIR);
  const { errors, criticalBlocks } = validateBundle(bundle);
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(criticalBlocks, []);
  assert.strictEqual(isApprovable(bundle), true);
});

test("the audit-feature approved example bundle is structurally valid and approvable", () => {
  const bundle = loadBundle(AUDIT_FEATURE_DIR);
  const { errors, criticalBlocks } = validateBundle(bundle);
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(criticalBlocks, []);
  assert.strictEqual(isApprovable(bundle), true);
});

test("an unresolved critical ambiguity blocks approval", () => {
  const bundle = loadBundle(MODERNIZATION_DIR);
  const mutated = {
    ...bundle,
    ambiguities: {
      items: [
        { id: "AMB-X", description: "unresolved", severity: "critical", resolution: "tbd", status: "open" }
      ]
    }
  };
  const { criticalBlocks } = validateBundle(mutated);
  assert.ok(criticalBlocks.some((msg) => msg.includes("AMB-X")));
  assert.strictEqual(isApprovable(mutated), false);
});

test("an untestable requirement blocks approval", () => {
  const bundle = loadBundle(MODERNIZATION_DIR);
  const mutated = {
    ...bundle,
    requirements: {
      items: [
        { id: "REQ-X", statement: "vague", rationale: "n/a", testable: false }
      ]
    },
    traceability: {
      links: [{ requirementId: "REQ-X", acceptanceCriteriaIds: ["AC-1"], invariantIds: [], riskIds: [] }]
    }
  };
  const { criticalBlocks } = validateBundle(mutated);
  assert.ok(criticalBlocks.some((msg) => msg.includes("REQ-X") && msg.includes("untestable")));
  assert.strictEqual(isApprovable(mutated), false);
});

test("an untestable acceptance criterion blocks approval", () => {
  const bundle = loadBundle(MODERNIZATION_DIR);
  const mutated = {
    ...bundle,
    acceptanceCriteria: {
      items: [
        { id: "AC-X", requirementId: "REQ-1", given: "g", when: "w", then: "t", testable: false }
      ]
    }
  };
  const { criticalBlocks } = validateBundle(mutated);
  assert.ok(criticalBlocks.some((msg) => msg.includes("AC-X")));
});

test("a requirement without a traceability link is a structural error", () => {
  const bundle = loadBundle(MODERNIZATION_DIR);
  const mutated = { ...bundle, traceability: { links: [] } };
  const { errors } = validateBundle(mutated);
  assert.ok(errors.length > 0);
  assert.ok(errors.some((msg) => msg.includes("no traceability link")));
});

test("traceability rejects unknown or cross-requirement acceptance criteria", () => {
  const bundle = loadBundle(MODERNIZATION_DIR);
  const [firstLink] = bundle.traceability.links;
  const criterion = bundle.acceptanceCriteria.items.find(
    (entry) => entry.requirementId !== firstLink.requirementId
  );
  const unknown = {
    ...bundle,
    traceability: {
      links: bundle.traceability.links.map((link, index) =>
        index === 0 ? { ...link, acceptanceCriteriaIds: ["AC-UNKNOWN"] } : link
      )
    }
  };
  const crossRequirement = {
    ...bundle,
    traceability: {
      links: bundle.traceability.links.map((link, index) =>
        index === 0 ? { ...link, acceptanceCriteriaIds: [criterion.id] } : link
      )
    }
  };
  assert.ok(validateBundle(unknown).errors.some((message) => message.includes("unknown acceptance criterion")));
  assert.ok(validateBundle(crossRequirement).errors.some((message) => message.includes("belongs to requirement")));
});

test("a missing stage file is reported as a structural error", () => {
  const bundle = loadBundle(MODERNIZATION_DIR);
  const { risks, ...withoutRisks } = bundle;
  const { errors } = validateBundle(withoutRisks);
  assert.ok(errors.some((msg) => msg.includes("risks.json")));
});

test("sign-off decision must be approved or rejected", () => {
  const bundle = loadBundle(MODERNIZATION_DIR);
  const mutated = { ...bundle, signoff: { ...bundle.signoff, decision: "pending" } };
  const { errors } = validateBundle(mutated);
  assert.ok(errors.some((msg) => msg.includes('"decision"')));
});

test("an unattested blindness attestation blocks approval even with an otherwise complete bundle", () => {
  const bundle = loadBundle(MODERNIZATION_DIR);
  const mutated = {
    ...bundle,
    signoff: {
      ...bundle.signoff,
      blindnessAttestation: { attested: false, statement: "not yet attested" }
    }
  };
  const { criticalBlocks } = validateBundle(mutated);
  assert.ok(criticalBlocks.some((msg) => msg.includes("blindnessAttestation")));
  assert.strictEqual(isApprovable(mutated), false);
});

test("a blindness attestation explicitly set to false (not merely absent) also blocks approval", () => {
  const bundle = loadBundle(MODERNIZATION_DIR);
  const mutated = {
    ...bundle,
    signoff: {
      ...bundle.signoff,
      blindnessAttestation: { attested: false, statement: "spec authors reviewed the evaluator rubric" }
    }
  };
  const { criticalBlocks } = validateBundle(mutated);
  assert.ok(criticalBlocks.some((msg) => msg.toLowerCase().includes("attested")));
});

test("an empty authors list is a structural error", () => {
  const bundle = loadBundle(MODERNIZATION_DIR);
  const mutated = { ...bundle, signoff: { ...bundle.signoff, authors: [] } };
  const { errors } = validateBundle(mutated);
  assert.ok(errors.some((msg) => msg.includes('"authors"')));
});

test("an approved sign-off requires identified approving reviewers and a valid timestamp", () => {
  const bundle = loadBundle(MODERNIZATION_DIR);
  const noReviewers = {
    ...bundle,
    signoff: { ...bundle.signoff, reviewers: [] }
  };
  const rejectingReviewer = {
    ...bundle,
    signoff: {
      ...bundle.signoff,
      reviewers: [{ name: "Independent reviewer", role: "Engineering Lead", verdict: "reject" }]
    }
  };
  const invalidTimestamp = {
    ...bundle,
    signoff: { ...bundle.signoff, decidedAt: "not-a-timestamp" }
  };

  assert.ok(validateBundle(noReviewers).errors.some((message) => message.includes('"reviewers"')));
  assert.strictEqual(isApprovable(noReviewers), false);
  assert.ok(
    validateBundle(rejectingReviewer).criticalBlocks.some((message) =>
      message.includes("every listed reviewer")
    )
  );
  assert.strictEqual(isApprovable(rejectingReviewer), false);
  assert.ok(
    validateBundle(invalidTimestamp).errors.some((message) => message.includes('"decidedAt"'))
  );
});

test("a missing authoringEffort field is a structural error", () => {
  const bundle = loadBundle(MODERNIZATION_DIR);
  const { authoringEffort, ...signoffWithoutEffort } = bundle.signoff;
  const mutated = { ...bundle, signoff: signoffWithoutEffort };
  const { errors } = validateBundle(mutated);
  assert.ok(errors.some((msg) => msg.includes("authoringEffort")));
});
