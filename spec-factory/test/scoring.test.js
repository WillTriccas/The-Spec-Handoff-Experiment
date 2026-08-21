import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBundle } from "../src/bundle.js";
import { scoreBundle, SPEC_SCORING_WEIGHTS } from "../src/scoring.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODERNIZATION_DIR = path.join(__dirname, "..", "examples", "modernization", "approved");
const AUDIT_FEATURE_DIR = path.join(__dirname, "..", "examples", "audit-feature", "approved");

test("scoring weights sum to 100", () => {
  const total = Object.values(SPEC_SCORING_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.strictEqual(total, 100);
});

test("the modernization example scores 100 and is not blocked", () => {
  const bundle = loadBundle(MODERNIZATION_DIR);
  const result = scoreBundle(bundle);
  assert.strictEqual(result.blocked, false);
  assert.strictEqual(result.score, 100);
});

test("the audit-feature example scores 100 and is not blocked", () => {
  const bundle = loadBundle(AUDIT_FEATURE_DIR);
  const result = scoreBundle(bundle);
  assert.strictEqual(result.blocked, false);
  assert.strictEqual(result.score, 100);
});

test("an unresolved critical ambiguity forces score to 0 and blocked=true", () => {
  const bundle = loadBundle(MODERNIZATION_DIR);
  const mutated = {
    ...bundle,
    ambiguities: {
      items: [
        { id: "AMB-X", description: "unresolved", severity: "critical", resolution: "tbd", status: "open" }
      ]
    }
  };
  const result = scoreBundle(mutated);
  assert.strictEqual(result.blocked, true);
  assert.strictEqual(result.score, 0);
  assert.ok(result.blockingReasons.some((r) => r.includes("AMB-X")));
});

test("unresolved (non-critical) ambiguities reduce the clarity dimension without blocking", () => {
  const bundle = loadBundle(MODERNIZATION_DIR);
  const mutated = {
    ...bundle,
    ambiguities: {
      items: [
        { id: "AMB-1", description: "d", severity: "minor", resolution: "r", status: "open" },
        { id: "AMB-2", description: "d", severity: "minor", resolution: "r", status: "resolved" }
      ]
    }
  };
  const result = scoreBundle(mutated);
  assert.strictEqual(result.blocked, false);
  assert.strictEqual(result.dimensions.clarity, 0.5);
  assert.ok(result.score < 100);
});

test("a missing stage produces a fully blocked, zero score", () => {
  const bundle = loadBundle(MODERNIZATION_DIR);
  const { risks, ...withoutRisks } = bundle;
  const result = scoreBundle(withoutRisks);
  assert.strictEqual(result.blocked, true);
  assert.strictEqual(result.score, 0);
  assert.strictEqual(result.dimensions, null);
});
