import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const catalogRoot = path.join(repoRoot, "evidence", "test-runs");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

test("every indexed test run has its required human and machine-readable artifacts", () => {
  const index = readJson(path.join(catalogRoot, "index.json"));
  assert.strictEqual(index.schemaVersion, "evidence-test-run-index/1.0.0");
  assert.ok(index.testRuns.length > 0);
  assert.strictEqual(
    new Set(index.testRuns.map((run) => run.id)).size,
    index.testRuns.length,
    "test-run ids must be unique"
  );

  for (const indexedRun of index.testRuns) {
    const runRoot = path.join(catalogRoot, indexedRun.id);
    const manifestPath = path.resolve(catalogRoot, indexedRun.manifest);
    assert.ok(existsSync(path.join(runRoot, "README.md")), `${indexedRun.id} needs README.md`);
    assert.ok(existsSync(manifestPath), `${indexedRun.id} needs its indexed manifest`);

    const manifest = readJson(manifestPath);
    assert.strictEqual(manifest.id, indexedRun.id);
    assert.strictEqual(manifest.benchmarkVersion, indexedRun.benchmarkVersion);
    assert.strictEqual(manifest.headlineOutcome, indexedRun.headlineOutcome);

    const requiredRelativePaths = [
      manifest.plainEnglish.overview,
      ...manifest.plainEnglish.episodes,
      ...manifest.plainEnglish.rounds
    ];
    for (const relativePath of requiredRelativePaths) {
      assert.ok(
        existsSync(path.resolve(runRoot, relativePath)),
        `${indexedRun.id} is missing ${relativePath}`
      );
    }

    for (const [name, relativePath] of Object.entries(manifest.canonicalArtifacts)) {
      assert.ok(
        existsSync(path.resolve(runRoot, relativePath)),
        `${indexedRun.id} canonical artifact ${name} does not resolve`
      );
    }
  }
});

test("the published v1.0.0 plain-English round totals match the measured report", () => {
  const report = readJson(path.join(repoRoot, "evidence", "measured", "report.json"));
  const runs = report.episodes.flatMap((episode) => episode.runs);
  const tokenTotal = (run) =>
    (run.inputTokens ?? 0) +
    (run.cachedInputTokens ?? 0) +
    (run.outputTokens ?? 0) +
    (run.reasoningTokens ?? 0) +
    (run.specAuthoringAmortizedTokens ?? 0);
  const expectedRoundTotals = [65_692_922, 72_240_465, 77_256_470];

  for (const repetition of [1, 2, 3]) {
    const roundRuns = runs.filter((run) => run.repetition === repetition);
    assert.strictEqual(roundRuns.length, 8);
    assert.strictEqual(
      roundRuns.reduce((sum, run) => sum + tokenTotal(run), 0),
      expectedRoundTotals[repetition - 1]
    );
  }
});
