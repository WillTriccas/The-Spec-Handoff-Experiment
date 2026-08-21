import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { importRun } from "../src/import.js";
import {
  CONFIG_DIR,
  CONTRACTS_DIR,
  REPO_ROOT,
  loadCostsConfig,
  loadExperimentConfig
} from "../src/config.js";
import {
  hashDirectory,
  hashFile,
  hashText,
  prepareRunWorkspace
} from "../src/prepare.js";
import { assignRandomizedOrder, buildPlannedRuns } from "../src/runs.js";

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "bench-import-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writePlan(runDir, overrides = {}) {
  const promptPath = path.join(runDir, "PROMPT.md");
  const promptText = "test prompt";
  writeFileSync(promptPath, promptText, "utf8");
  const workspaceDir = path.join(runDir, "workspace");
  mkdirSync(workspaceDir, { recursive: true });
  writeFileSync(path.join(workspaceDir, "baseline.txt"), "baseline", "utf8");
  execFileSync("git", ["init", "--quiet"], { cwd: workspaceDir });
  execFileSync("git", ["config", "user.name", "Benchmark Test"], { cwd: workspaceDir });
  execFileSync("git", ["config", "user.email", "benchmark@test.invalid"], {
    cwd: workspaceDir
  });
  execFileSync("git", ["add", "--all"], { cwd: workspaceDir });
  execFileSync("git", ["commit", "--quiet", "-m", "baseline"], { cwd: workspaceDir });
  const workspaceBaselineCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: workspaceDir
  })
    .toString("utf8")
    .trim();
  const workspaceBaselineSha256 = hashDirectory(workspaceDir);
  const plan = {
    schemaVersion: "1.1.0",
    runId: "modernization-efficient-spec-r1",
    episodeId: "modernization",
    laneId: "efficient-spec",
    model: { id: "mai-code-1.1-flash", displayName: "MAI Code 1.1 Flash", tier: "efficient", buildId: null, agentVersion: null, effortParams: null },
    inputMode: "spec",
    repetition: 1,
    baseline: { ref: "refs/tags/benchmark-legacy-v1", sha256: workspaceBaselineSha256 },
    brief: { path: "benchmark/prompts/modernization-raw.md", sha256: "c".repeat(64) },
    promptSha256: hashText(promptText),
    spec: {
      id: "modernization-approved",
      sha256: "b".repeat(64),
      qualityScore: 100,
      authoringEffort: {
        elapsedSeconds: 120,
        inputTokens: 20,
        outputTokens: 10,
        estimatedCostUsd: null,
        costEvidenceRef: null,
        costMethod: null,
        amortizedAcrossRuns: 3
      }
    },
    executionOrder: 15,
    executionPolicySnapshot: { timeoutSeconds: 7200, toolCallCap: 200 },
    workspaceDir,
    workspaceBaselineCommit,
    promptPath,
    ...overrides
  };
  writeFileSync(path.join(runDir, "plan.json"), JSON.stringify(plan), "utf8");
  return plan;
}

function baseArgs(runDir, overrides = {}) {
  const diffPath = path.join(runDir, "candidate.patch");
  const transcriptPath = path.join(runDir, "transcript.log");
  const evaluatorPath = path.join(runDir, "evaluator.json");
  if (!existsSync(diffPath)) writeFileSync(diffPath, "", "utf8");
  if (!existsSync(transcriptPath)) writeFileSync(transcriptPath, "transcript", "utf8");
  if (!existsSync(evaluatorPath)) {
    writeFileSync(evaluatorPath, JSON.stringify({ checks: [], hardGates: [] }), "utf8");
  }
  const workspaceDir = path.join(runDir, "workspace");
  const sourceCommit = existsSync(path.join(workspaceDir, ".git"))
    ? execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspaceDir })
        .toString("utf8")
        .trim()
    : "abc1234";
  return {
    runDir,
    benchmarkVersion: "unfrozen",
    dataKind: "illustrative",
    baselineCommit: "abcdef1234",
    execution: {
      status: "completed",
      startedAt: "2024-06-01T10:00:00Z",
      endedAt: "2024-06-01T10:20:00Z",
      elapsedSeconds: 1200,
      order: 15,
      modelId: "mai-code-1.1-flash",
      modelBuildId: "model-build-1",
      agentVersion: "v1",
      toolCalls: 10,
      inputTokens: 100,
      outputTokens: 50,
      estimatedCostUsd: null
    },
    source: {
      commit: sourceCommit,
      diffPath,
      bundlePath: path.join(runDir, "source.bundle")
    },
    evidence: { directory: runDir, transcriptPath, evaluatorPath },
    ...overrides
  };
}

function writeFrozenProvenance(runDir) {
  const hashes = {
    taskBriefSha256: "c".repeat(64),
    promptSha256: hashText("test prompt"),
    specManifestSha256: "b".repeat(64),
    evaluatorSha256: hashDirectory(path.join(REPO_ROOT, "evaluator")),
    scoringConfigSha256: hashFile(path.join(CONFIG_DIR, "scoring.json")),
    experimentConfigSha256: hashFile(path.join(CONFIG_DIR, "experiment.json")),
    costsConfigSha256: hashFile(path.join(CONFIG_DIR, "costs.json")),
    benchmarkEngineSha256: hashDirectory(path.join(REPO_ROOT, "benchmark", "src")),
    runSchemaSha256: hashFile(path.join(CONTRACTS_DIR, "run.schema.json")),
    reportSchemaSha256: hashFile(path.join(CONTRACTS_DIR, "report.schema.json"))
  };
  hashes.planSha256 = hashFile(path.join(runDir, "plan.json"));
  hashes.baselineSha256 = JSON.parse(
    readFileSync(path.join(runDir, "plan.json"), "utf8")
  ).baseline.sha256;
  writeFileSync(
    path.join(runDir, "provenance.json"),
    JSON.stringify({
      schemaVersion: "1.1.0",
      runId: "modernization-efficient-spec-r1",
      hashes
    }),
    "utf8"
  );
  return hashes;
}

function writeFrozenRecord(runDir, hashes, preparedPlan = null) {
  const plan = preparedPlan ?? JSON.parse(
    readFileSync(path.join(runDir, "plan.json"), "utf8")
  );
  const record = {
    schemaVersion: "freeze-readiness/1.0.0",
    generatedAt: "2025-01-01T00:00:00Z",
    ready: true,
    blockers: [],
    benchmarkVersion: "benchmark-v1",
    repository: { headCommit: "head-commit", clean: true, dirtyEntries: [] },
    baselines: [
      {
        episodeId: "modernization",
        ref: plan.baseline.ref,
        commit: "abcdef1234",
        path: "src/legacy-trade-reconciliation",
        sha256: hashes.baselineSha256,
        archiveSha256: "9".repeat(64)
      }
    ],
    promptsAndSpecs: [
      {
        episodeId: "modernization",
        taskBriefPath: plan.brief.path,
        taskBriefSha256: plan.brief.sha256,
        rawPromptSha256: plan.promptSha256,
        specPromptSha256: plan.promptSha256,
        specBundlePath: "spec-factory/examples/modernization/approved",
        specManifestSha256: hashes.specManifestSha256,
        assembledSpecSha256: plan.spec?.sha256 ?? null,
        specQualityScore: plan.spec?.qualityScore ?? null,
        specAuthoringEffort: {
          elapsedMinutes: (plan.spec?.authoringEffort?.elapsedSeconds ?? 0) / 60,
          inputTokens: plan.spec?.authoringEffort?.inputTokens ?? 0,
          outputTokens: plan.spec?.authoringEffort?.outputTokens ?? 0,
          estimatedCostUsd: plan.spec?.authoringEffort?.estimatedCostUsd ?? null,
          costEvidenceRef: plan.spec?.authoringEffort?.costEvidenceRef ?? null,
          costMethod: plan.spec?.authoringEffort?.costMethod ?? null
        }
      }
    ],
    frozenInputs: {
      evaluatorSha256: hashes.evaluatorSha256,
      scoringConfigSha256: hashes.scoringConfigSha256,
      experimentConfigSha256: hashes.experimentConfigSha256,
      costsConfigSha256: hashes.costsConfigSha256,
      benchmarkEngineSha256: hashes.benchmarkEngineSha256,
      runSchemaSha256: hashes.runSchemaSha256,
      reportSchemaSha256: hashes.reportSchemaSha256,
      claimRule: {},
      costsConfig: loadCostsConfig()
    },
    models: [
      {
        tier: "efficient",
        id: plan.model.id,
        displayName: plan.model.displayName,
        buildId: plan.model.buildId ?? "model-build-1",
        agentVersion: plan.model.agentVersion ?? "agent-1",
        agentBuildId: plan.model.agentBuildId ?? "agent-build-1",
        effortParams: plan.model.effortParams ?? { reasoningEffort: "low" }
      }
    ],
    repetitionsPerLane: 3,
    executionPolicy: plan.executionPolicySnapshot,
    pricing: { pricingAsOf: null, source: null, rateType: "unavailable", monetaryClaimsEnabled: false },
    approvals: Object.fromEntries(
      ["scenario", "specifications", "evaluator", "claimAdjudication"].map((area) => [
        area,
        {
          approved: true,
          reviewer: `reviewer-${area}`,
          approvedAt: "2025-01-01T00:00:00Z",
          evidenceRef: `reviews/${area}`
        }
      ])
    )
  };
  record.recordSha256 = createHash("sha256").update(JSON.stringify(record)).digest("hex");
  const recordPath = path.join(runDir, "freeze-readiness.json");
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return { recordPath, recordSha256: record.recordSha256 };
}

test("a normally prepared plan binds the policy required by measured import", () => {
  withTempDir((baselineDir) => {
    writeFileSync(path.join(baselineDir, "Program.cs"), "// legacy code", "utf8");
    withTempDir((outputRoot) => {
      const experimentConfig = structuredClone(loadExperimentConfig());
      experimentConfig.models.efficient = {
        ...experimentConfig.models.efficient,
        buildId: "model-build-1",
        agentVersion: "agent-1",
        agentBuildId: "agent-build-1",
        effortParams: { reasoningEffort: "low" }
      };
      const run = assignRandomizedOrder(buildPlannedRuns(experimentConfig)).find(
        (entry) => entry.runId === "modernization-efficient-spec-r1"
      );
      const prepared = prepareRunWorkspace(run, {
        baselineDir,
        outputRoot,
        repoRoot: REPO_ROOT,
        experimentConfig
      });
      const provenance = JSON.parse(readFileSync(prepared.provenancePath, "utf8"));
      const freeze = writeFrozenRecord(
        prepared.runDir,
        provenance.hashes,
        prepared.plan
      );
      const args = baseArgs(prepared.runDir, {
        benchmarkVersion: "benchmark-v1",
        dataKind: "measured",
        freezeRecordSha256: freeze.recordSha256,
        freezeRecordPath: freeze.recordPath,
        experimentConfig,
        execution: {
          ...baseArgs(prepared.runDir).execution,
          order: prepared.plan.executionOrder,
          agentVersion: "agent-1",
          agentBuildId: "agent-build-1",
          reasoningEffort: "low"
        }
      });

      const { run: imported } = importRun(args);

      assert.deepStrictEqual(
        prepared.plan.executionPolicySnapshot,
        experimentConfig.executionPolicy
      );
      assert.strictEqual(imported.runId, prepared.plan.runId);
      assert.strictEqual(imported.dataKind, "measured");
    });
  });
});

test("importRun throws when plan.json is missing", () => {
  withTempDir((runDir) => {
    assert.throws(() => importRun(baseArgs(runDir)), /plan\.json/);
  });
});

test("importRun produces a schema-valid run.json with baseline.commit set from baselineCommit, not source.commit", () => {
  withTempDir((runDir) => {
    writePlan(runDir);
    const { run, runJsonPath } = importRun(baseArgs(runDir, { baselineCommit: "baseline-commit-sha", source: { commit: "output-commit-sha", diffPath: "diffs/x.patch" } }));
    assert.strictEqual(run.baseline.commit, "baseline-commit-sha");
    assert.strictEqual(run.source.commit, "output-commit-sha");
    assert.notStrictEqual(run.baseline.commit, run.source.commit);
    assert.ok(existsSync(runJsonPath));
    const onDisk = JSON.parse(readFileSync(runJsonPath, "utf8"));
    assert.strictEqual(onDisk.runId, "modernization-efficient-spec-r1");
  });
});

test("importRun preserves a null source.commit for a failed/incomplete run", () => {
  withTempDir((runDir) => {
    writePlan(runDir);
    const { run } = importRun(
      baseArgs(runDir, {
        execution: {
          status: "failed",
          startedAt: "2024-06-01T10:00:00Z",
          endedAt: "2024-06-01T10:05:00Z",
          elapsedSeconds: 300,
          agentVersion: "v1",
          toolCalls: 2,
          inputTokens: null,
          outputTokens: null,
          estimatedCostUsd: null
        },
        source: { commit: null, diffPath: "diffs/x.patch" }
      })
    );
    assert.strictEqual(run.execution.status, "failed");
    assert.strictEqual(run.source.commit, null);
  });
});

test("importRun carries spec=null through for a raw-lane plan", () => {
  withTempDir((runDir) => {
    writePlan(runDir, { laneId: "efficient-raw", inputMode: "raw", spec: null });
    const { run } = importRun(baseArgs(runDir));
    assert.strictEqual(run.spec, null);
    assert.strictEqual(run.inputMode, "raw");
  });
});

test("importRun throws if the assembled run fails contract schema validation", () => {
  withTempDir((runDir) => {
    writePlan(runDir, { laneId: "not-a-real-lane" });
    assert.throws(() => importRun(baseArgs(runDir)), /schema/i);
  });
});

test("importRun throws when a raw-lane plan carries a non-null spec", () => {
  withTempDir((runDir) => {
    writePlan(runDir, {
      laneId: "efficient-raw",
      inputMode: "raw",
      spec: {
        id: "modernization-approved",
        sha256: "b".repeat(64),
        qualityScore: 100,
        authoringEffort: {
          elapsedSeconds: 120,
          inputTokens: 20,
          outputTokens: 10,
          estimatedCostUsd: null,
          amortizedAcrossRuns: 3
        }
      }
    });
    assert.throws(() => importRun(baseArgs(runDir)), /schema|raw-lane run/i);
  });
});

test("importRun throws when a spec-lane plan carries a null spec", () => {
  withTempDir((runDir) => {
    writePlan(runDir, { laneId: "efficient-spec", inputMode: "spec", spec: null });
    assert.throws(() => importRun(baseArgs(runDir)), /schema|spec-lane run/i);
  });
});

test("importRun throws when the plan's model.id doesn't match the model tier's configured model", () => {
  withTempDir((runDir) => {
    writePlan(runDir, { model: { id: "not-the-configured-model", displayName: "x", tier: "efficient" } });
    assert.throws(() => importRun(baseArgs(runDir)), /model\.id/);
  });
});

test("importRun writes a provenance.json merging prepare-time hashes with import-time frozen versions", () => {
  withTempDir((runDir) => {
    writeFileSync(
      path.join(runDir, "provenance.json"),
      JSON.stringify({ schemaVersion: "1.0.0", runId: "modernization-efficient-spec-r1", hashes: { taskBriefSha256: null, specManifestSha256: "c".repeat(64) } }),
      "utf8"
    );
    writePlan(runDir);
    const { provenancePath } = importRun(baseArgs(runDir, { benchmarkVersion: "unfrozen" }));
    const provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
    assert.strictEqual(provenance.hashes.specManifestSha256, "c".repeat(64));
    assert.strictEqual(provenance.frozenVersions.benchmarkVersion, "unfrozen");
    assert.strictEqual(provenance.frozenVersions.baselineRef, "refs/tags/benchmark-legacy-v1");
    assert.match(provenance.hashes.costsConfigSha256, /^[a-f0-9]{64}$/);
  });
});

test("importRun rejects measured evidence without a frozen benchmark record", () => {
  withTempDir((runDir) => {
    writePlan(runDir, {
      model: {
        id: "mai-code-1.1-flash",
        displayName: "MAI Code 1.1 Flash",
        tier: "efficient",
        buildId: "model-build-1",
        agentVersion: "agent-1",
        agentBuildId: "agent-build-1",
        effortParams: { reasoningEffort: "low" }
      }
    });
    writeFrozenProvenance(runDir);

    assert.throws(
      () =>
        importRun(
          baseArgs(runDir, {
            benchmarkVersion: "benchmark-v1",
            dataKind: "measured",
            execution: {
              ...baseArgs(runDir).execution,
              agentVersion: "agent-1",
              agentBuildId: "agent-build-1",
              reasoningEffort: "low"
            }
          })
        ),
      /freezeRecordSha256/
    );
  });
});

test("importRun records complete frozen inputs for measured evidence", () => {
  withTempDir((runDir) => {
    writePlan(runDir, {
      model: {
        id: "mai-code-1.1-flash",
        displayName: "MAI Code 1.1 Flash",
        tier: "efficient",
        buildId: "model-build-1",
        agentVersion: "agent-1",
        agentBuildId: "agent-build-1",
        effortParams: { reasoningEffort: "low" }
      }
    });
    const hashes = writeFrozenProvenance(runDir);
    const freeze = writeFrozenRecord(runDir, hashes);
    const evaluatorPath = path.join(runDir, "measured-evaluator.json");
    writeFileSync(evaluatorPath, JSON.stringify({ checks: [], hardGates: [] }), "utf8");

    const { run } = importRun(
      baseArgs(runDir, {
        benchmarkVersion: "benchmark-v1",
        dataKind: "measured",
        freezeRecordSha256: freeze.recordSha256,
        freezeRecordPath: freeze.recordPath,
        execution: {
          ...baseArgs(runDir).execution,
          agentVersion: "agent-1",
          agentBuildId: "agent-build-1",
          reasoningEffort: "low",
          estimatedCostUsd: 999
        },
        evidence: {
          ...baseArgs(runDir).evidence,
          evaluatorPath
        }
      })
    );

    assert.strictEqual(run.frozenInputs.freezeRecordSha256, freeze.recordSha256);
    assert.strictEqual(run.frozenInputs.evaluatorSha256, hashes.evaluatorSha256);
    assert.strictEqual(run.frozenInputs.scoringConfigSha256, hashes.scoringConfigSha256);
    assert.strictEqual(run.model.buildId, "model-build-1");
    assert.strictEqual(run.execution.agentBuildId, "agent-build-1");
    assert.strictEqual(run.execution.estimatedCostUsd, null);
    assert.strictEqual(run.evidence.evaluatorSha256, hashFile(evaluatorPath));
  });
});

test("importRun rejects execution settings that drift from the freeze record", () => {
  withTempDir((runDir) => {
    writePlan(runDir, {
      model: {
        id: "mai-code-1.1-flash",
        displayName: "MAI Code 1.1 Flash",
        tier: "efficient",
        buildId: "model-build-1",
        agentVersion: "agent-1",
        agentBuildId: "agent-build-1",
        effortParams: { reasoningEffort: "low" }
      }
    });
    const hashes = writeFrozenProvenance(runDir);
    const freeze = writeFrozenRecord(runDir, hashes);

    assert.throws(
      () =>
        importRun(
          baseArgs(runDir, {
            benchmarkVersion: "benchmark-v1",
            dataKind: "measured",
            freezeRecordSha256: freeze.recordSha256,
            freezeRecordPath: freeze.recordPath,
            execution: {
              ...baseArgs(runDir).execution,
              agentVersion: "drifted-agent",
              agentBuildId: "agent-build-1",
              reasoningEffort: "low"
            }
          })
        ),
      /executed agent version/
    );
  });
});

test("importRun accepts and preserves a run stopped at the 120-minute boundary", () => {
  withTempDir((runDir) => {
    writePlan(runDir, {
      model: {
        id: "mai-code-1.1-flash",
        displayName: "MAI Code 1.1 Flash",
        tier: "efficient",
        buildId: "model-build-1",
        agentVersion: "agent-1",
        agentBuildId: "agent-build-1",
        effortParams: { reasoningEffort: "low" }
      }
    });
    const hashes = writeFrozenProvenance(runDir);
    const freeze = writeFrozenRecord(runDir, hashes);
    const { run } = importRun(
      baseArgs(runDir, {
        benchmarkVersion: "benchmark-v1",
        dataKind: "measured",
        freezeRecordSha256: freeze.recordSha256,
        freezeRecordPath: freeze.recordPath,
        execution: {
          ...baseArgs(runDir).execution,
          status: "timed-out",
          elapsedSeconds: 7200,
          agentVersion: "agent-1",
          agentBuildId: "agent-build-1",
          reasoningEffort: "low"
        }
      })
    );
    assert.strictEqual(run.execution.status, "timed-out");
    assert.strictEqual(run.execution.elapsedSeconds, 7200);
  });
});

test("importRun rejects executed model, order, timeout, and tool-cap drift", () => {
  withTempDir((runDir) => {
    writePlan(runDir, {
      model: {
        id: "mai-code-1.1-flash",
        displayName: "MAI Code 1.1 Flash",
        tier: "efficient",
        buildId: "model-build-1",
        agentVersion: "agent-1",
        agentBuildId: "agent-build-1",
        effortParams: { reasoningEffort: "low" }
      }
    });
    const hashes = writeFrozenProvenance(runDir);
    const freeze = writeFrozenRecord(runDir, hashes);
    const cases = [
      [{ modelId: "wrong-model" }, /executed model id/],
      [{ modelBuildId: "wrong-build" }, /executed model build/],
      [{ order: 2 }, /execution order/],
      [{ elapsedSeconds: 7201 }, /timeoutSeconds/],
      [{ toolCalls: 201 }, /toolCallCap/]
    ];

    for (const [executionOverride, expectedError] of cases) {
      assert.throws(
        () =>
          importRun(
            baseArgs(runDir, {
              benchmarkVersion: "benchmark-v1",
              dataKind: "measured",
              freezeRecordSha256: freeze.recordSha256,
              freezeRecordPath: freeze.recordPath,
              execution: {
                ...baseArgs(runDir).execution,
                agentVersion: "agent-1",
                agentBuildId: "agent-build-1",
                reasoningEffort: "low",
                ...executionOverride
              }
            })
          ),
        expectedError
      );
    }
  });
});

test("importRun rejects a measured prompt changed after preparation", () => {
  withTempDir((runDir) => {
    const plan = writePlan(runDir, {
      model: {
        id: "mai-code-1.1-flash",
        displayName: "MAI Code 1.1 Flash",
        tier: "efficient",
        buildId: "model-build-1",
        agentVersion: "agent-1",
        agentBuildId: "agent-build-1",
        effortParams: { reasoningEffort: "low" }
      }
    });
    const hashes = writeFrozenProvenance(runDir);
    const freeze = writeFrozenRecord(runDir, hashes);
    writeFileSync(plan.promptPath, "tampered prompt", "utf8");

    assert.throws(
      () =>
        importRun(
          baseArgs(runDir, {
            benchmarkVersion: "benchmark-v1",
            dataKind: "measured",
            freezeRecordSha256: freeze.recordSha256,
            freezeRecordPath: freeze.recordPath,
            execution: {
              ...baseArgs(runDir).execution,
              agentVersion: "agent-1",
              agentBuildId: "agent-build-1",
              reasoningEffort: "low"
            }
          })
        ),
      /prompt file hash/
    );
  });
});

test("importRun rejects a changed prepared plan and artifact paths outside the run directory", () => {
  withTempDir((runDir) => {
    const plan = writePlan(runDir, {
      model: {
        id: "mai-code-1.1-flash",
        displayName: "MAI Code 1.1 Flash",
        tier: "efficient",
        buildId: "model-build-1",
        agentVersion: "agent-1",
        agentBuildId: "agent-build-1",
        effortParams: { reasoningEffort: "low" }
      }
    });
    let hashes = writeFrozenProvenance(runDir);
    let freeze = writeFrozenRecord(runDir, hashes);
    const execution = {
      ...baseArgs(runDir).execution,
      agentVersion: "agent-1",
      agentBuildId: "agent-build-1",
      reasoningEffort: "low"
    };
    const measuredArgs = () =>
      baseArgs(runDir, {
        benchmarkVersion: "benchmark-v1",
        dataKind: "measured",
        freezeRecordSha256: freeze.recordSha256,
        freezeRecordPath: freeze.recordPath,
        execution
      });

    writeFileSync(
      path.join(runDir, "plan.json"),
      JSON.stringify({ ...plan, repetition: 2 }),
      "utf8"
    );
    assert.throws(() => importRun(measuredArgs()), /prepared plan hash/);

    writeFileSync(path.join(runDir, "plan.json"), JSON.stringify(plan), "utf8");
    hashes = writeFrozenProvenance(runDir);
    freeze = writeFrozenRecord(runDir, hashes);
    const escaping = measuredArgs();
    escaping.source.diffPath = path.join(path.dirname(runDir), "outside.patch");
    assert.throws(
      () => importRun(escaping),
      /source diff path escapes the prepared run directory/
    );
  });
});

test("importRun leaves estimatedCostUsd null when costs.json has no dated pricing for the model", () => {
  withTempDir((runDir) => {
    writePlan(runDir);
    const { run } = importRun(baseArgs(runDir, { costsConfig: { models: {} } }));
    assert.strictEqual(run.execution.estimatedCostUsd, null);
  });
});

test("importRun prices reasoningTokens using the configured reasoning-output rate", () => {
  withTempDir((runDir) => {
    writePlan(runDir, { laneId: "efficient-raw", inputMode: "raw", spec: null });
    const costsConfig = {
      models: {
        "mai-code-1.1-flash": {
          pricingAsOf: "2025-01-01",
          source: "test fixture",
          rateType: "list",
          inputPerMillionTokens: 0,
          outputPerMillionTokens: 0,
          reasoningOutputPerMillionTokens: 3
        }
      }
    };
    const { run } = importRun(
      baseArgs(runDir, {
        costsConfig,
        execution: { ...baseArgs(runDir).execution, reasoningTokens: 100 }
      })
    );
    assert.strictEqual(run.execution.estimatedCostUsd, 0.0003);
  });
});

test("importRun auto-computes estimatedCostUsd from token usage once costs.json has dated pricing", () => {
  withTempDir((runDir) => {
    writePlan(runDir, { laneId: "efficient-raw", inputMode: "raw", spec: null });
    const costsConfig = {
      models: {
        "mai-code-1.1-flash": {
          pricingAsOf: "2025-01-01",
          source: "test fixture",
          rateType: "list",
          inputPerMillionTokens: 1,
          outputPerMillionTokens: 2
        }
      }
    };
    const { run } = importRun(baseArgs(runDir, { costsConfig }));
    // inputTokens=100, outputTokens=50 from baseArgs
    assert.strictEqual(run.execution.estimatedCostUsd, (100 / 1_000_000) * 1 + (50 / 1_000_000) * 2);
  });
});

test("importRun respects an explicit non-null estimatedCostUsd supplied by the caller over auto-computed cost", () => {
  withTempDir((runDir) => {
    writePlan(runDir);
    const costsConfig = {
      models: {
        "mai-code-1.1-flash": {
          pricingAsOf: "2025-01-01",
          source: "test fixture",
          rateType: "list",
          inputPerMillionTokens: 1,
          outputPerMillionTokens: 2
        }
      }
    };
    const { run } = importRun(
      baseArgs(runDir, { costsConfig, execution: { ...baseArgs(runDir).execution, estimatedCostUsd: 9.99 } })
    );
    assert.strictEqual(run.execution.estimatedCostUsd, 9.99);
  });
});

test("importRun leaves spec-lane cost null when authoring effort is unpriced", () => {
  withTempDir((runDir) => {
    writePlan(runDir); // spec lane (efficient-spec), episodeId "modernization"
    const costsConfig = {
      models: {
        "mai-code-1.1-flash": {
          pricingAsOf: "2025-01-01",
          source: "test fixture",
          rateType: "list",
          inputPerMillionTokens: 1,
          outputPerMillionTokens: 2
        }
      }
    };
    const { run } = importRun(baseArgs(runDir, { costsConfig }));
    assert.strictEqual(run.execution.estimatedCostUsd, null);
  });
});
