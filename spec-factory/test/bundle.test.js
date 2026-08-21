import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBundle, writeStage, assembleSpec, renderSpecMarkdown } from "../src/bundle.js";
import { STAGES } from "../src/stages.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODERNIZATION_DIR = path.join(__dirname, "..", "examples", "modernization", "approved");

test("loadBundle reads every stage file for the modernization example", () => {
  const bundle = loadBundle(MODERNIZATION_DIR);
  for (const stage of STAGES) {
    assert.ok(bundle[stage.id], `expected stage ${stage.id} to be present`);
  }
});

test("loadBundle omits stages whose file is absent", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "spec-bundle-"));
  try {
    writeStage(dir, "intent", { problemStatement: "x", goals: [], nonGoals: [], successMetrics: [], stakeholders: [] });
    const bundle = loadBundle(dir);
    assert.ok(bundle.intent);
    assert.strictEqual(bundle.discovery, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("assembleSpec includes schemaVersion and stage list", () => {
  const bundle = loadBundle(MODERNIZATION_DIR);
  const assembled = assembleSpec(bundle, { id: "test-id" });
  assert.strictEqual(assembled.schemaVersion, "1.0.0");
  assert.strictEqual(assembled.id, "test-id");
  assert.deepStrictEqual(assembled.stages, STAGES.map((s) => s.id));
});

test("renderSpecMarkdown produces a non-empty document with key sections", () => {
  const bundle = loadBundle(MODERNIZATION_DIR);
  const markdown = renderSpecMarkdown(bundle, { id: "modernization-approved", title: "Modernization" });
  assert.match(markdown, /## Intent/);
  assert.match(markdown, /## Requirements/);
  assert.match(markdown, /## Review and sign-off/);
  assert.match(markdown, /REQ-1/);
});
