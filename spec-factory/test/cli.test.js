import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cmdInit, cmdValidate, cmdScore, cmdApprove, cmdHash, cmdRender, run } from "../src/cli.js";
import { STAGES } from "../src/stages.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODERNIZATION_DIR = path.join(__dirname, "..", "examples", "modernization", "approved");

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "spec-factory-cli-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function captureConsole() {
  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => errors.push(args.join(" "));
  return {
    logs,
    errors,
    restore() {
      console.log = originalLog;
      console.error = originalError;
    }
  };
}

test("init scaffolds every stage template", () => {
  withTempDir((dir) => {
    const exitCode = cmdInit(dir);
    assert.strictEqual(exitCode, 0);
    for (const stage of STAGES) {
      assert.ok(existsSync(path.join(dir, stage.file)), `expected ${stage.file} to be scaffolded`);
    }
  });
});

test("init is idempotent and does not clobber edited stage files", () => {
  withTempDir((dir) => {
    cmdInit(dir);
    const intentPath = path.join(dir, "intent.json");
    const edited = JSON.stringify({ problemStatement: "edited", goals: [], nonGoals: [], successMetrics: [], stakeholders: [] });
    writeFileSync(intentPath, edited, "utf8");
    cmdInit(dir);
    assert.strictEqual(readFileSync(intentPath, "utf8"), edited);
  });
});

test("validate reports 0 exit code for the approved modernization example", () => {
  const capture = captureConsole();
  try {
    const exitCode = cmdValidate(MODERNIZATION_DIR);
    assert.strictEqual(exitCode, 0);
  } finally {
    capture.restore();
  }
});

test("validate reports a nonzero exit code and errors for an incomplete bundle", () => {
  withTempDir((dir) => {
    cmdInit(dir); // leaves default templates in place, which are not approvable (signoff=rejected, untestable placeholders are fine but ambiguity is open+critical)
    const capture = captureConsole();
    let exitCode;
    try {
      exitCode = cmdValidate(dir);
    } finally {
      capture.restore();
    }
    assert.strictEqual(exitCode, 1);
    assert.ok(capture.errors.some((line) => line.includes("BLOCKING")));
  });
});

test("score returns 0 exit code and a numeric score for an approvable bundle", () => {
  const capture = captureConsole();
  let exitCode;
  try {
    exitCode = cmdScore(MODERNIZATION_DIR);
  } finally {
    capture.restore();
  }
  assert.strictEqual(exitCode, 0);
  const parsed = JSON.parse(capture.logs.join(""));
  assert.strictEqual(parsed.blocked, false);
  assert.strictEqual(parsed.score, 100);
});

test("approve writes a manifest.json with a valid sha256 and quality score", () => {
  withTempDir((dir) => {
    cpSync(MODERNIZATION_DIR, dir, { recursive: true });
    const capture = captureConsole();
    let exitCode;
    try {
      exitCode = cmdApprove(dir, { id: "test-bundle" });
    } finally {
      capture.restore();
    }
    assert.strictEqual(exitCode, 0);
    const manifestPath = path.join(dir, "manifest.json");
    assert.ok(existsSync(manifestPath));
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.strictEqual(manifest.id, "test-bundle");
    assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
    assert.strictEqual(manifest.qualityScore, 100);
  });
});

test("approve writes authorship, blindness attestation and authoring effort into the manifest", () => {
  withTempDir((dir) => {
    cpSync(MODERNIZATION_DIR, dir, { recursive: true });
    const capture = captureConsole();
    try {
      cmdApprove(dir, { id: "test-bundle" });
    } finally {
      capture.restore();
    }
    const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
    assert.ok(manifest.authors.length > 0);
    assert.strictEqual(manifest.blindnessAttestation.attested, true);
    assert.strictEqual(typeof manifest.authoringEffort.elapsedMinutes, "number");
  });
});

test("approve refuses when the blindness attestation is not attested", () => {
  withTempDir((dir) => {
    cpSync(MODERNIZATION_DIR, dir, { recursive: true });
    rmSync(path.join(dir, "manifest.json"), { force: true });
    const signoffPath = path.join(dir, "signoff.json");
    const signoff = JSON.parse(readFileSync(signoffPath, "utf8"));
    signoff.blindnessAttestation = { attested: false, statement: "not attested" };
    writeFileSync(signoffPath, JSON.stringify(signoff), "utf8");
    const capture = captureConsole();
    let exitCode;
    try {
      exitCode = cmdApprove(dir, {});
    } finally {
      capture.restore();
    }
    assert.strictEqual(exitCode, 1);
    assert.ok(!existsSync(path.join(dir, "manifest.json")));
  });
});

test("approve refuses when signoff.decision is not approved", () => {
  withTempDir((dir) => {
    cpSync(MODERNIZATION_DIR, dir, { recursive: true });
    rmSync(path.join(dir, "manifest.json"), { force: true });
    const signoffPath = path.join(dir, "signoff.json");
    const signoff = JSON.parse(readFileSync(signoffPath, "utf8"));
    signoff.decision = "rejected";
    writeFileSync(signoffPath, JSON.stringify(signoff), "utf8");
    const capture = captureConsole();
    let exitCode;
    try {
      exitCode = cmdApprove(dir, {});
    } finally {
      capture.restore();
    }
    assert.strictEqual(exitCode, 1);
    assert.ok(!existsSync(path.join(dir, "manifest.json")));
  });
});

test("failed re-approval invalidates an existing manifest", () => {
  withTempDir((dir) => {
    cpSync(MODERNIZATION_DIR, dir, { recursive: true });
    assert.ok(existsSync(path.join(dir, "manifest.json")));
    const signoffPath = path.join(dir, "signoff.json");
    const signoff = JSON.parse(readFileSync(signoffPath, "utf8"));
    signoff.decision = "rejected";
    writeFileSync(signoffPath, JSON.stringify(signoff), "utf8");
    const capture = captureConsole();
    try {
      assert.strictEqual(cmdApprove(dir, {}), 1);
    } finally {
      capture.restore();
    }
    assert.ok(!existsSync(path.join(dir, "manifest.json")));
  });
});

test("approve refuses when a critical ambiguity is unresolved", () => {
  withTempDir((dir) => {
    cpSync(MODERNIZATION_DIR, dir, { recursive: true });
    rmSync(path.join(dir, "manifest.json"), { force: true });
    const ambiguitiesPath = path.join(dir, "ambiguities.json");
    writeFileSync(
      ambiguitiesPath,
      JSON.stringify({
        items: [{ id: "AMB-X", description: "d", severity: "critical", resolution: "r", status: "open" }]
      }),
      "utf8"
    );
    const capture = captureConsole();
    let exitCode;
    try {
      exitCode = cmdApprove(dir, {});
    } finally {
      capture.restore();
    }
    assert.strictEqual(exitCode, 1);
    assert.ok(!existsSync(path.join(dir, "manifest.json")));
  });
});

test("hash is deterministic for the same bundle content", () => {
  const capture = captureConsole();
  let exitCode;
  try {
    exitCode = cmdHash(MODERNIZATION_DIR, { id: "modernization-approved" });
  } finally {
    capture.restore();
  }
  assert.strictEqual(exitCode, 0);
  assert.match(capture.logs[0], /^[a-f0-9]{64}$/);

  const capture2 = captureConsole();
  cmdHash(MODERNIZATION_DIR, { id: "modernization-approved" });
  capture2.restore();
  assert.strictEqual(capture.logs[0], capture2.logs[0]);
});

test("render produces markdown with the requested title", () => {
  const capture = captureConsole();
  try {
    cmdRender(MODERNIZATION_DIR, { title: "My Spec" });
  } finally {
    capture.restore();
  }
  assert.match(capture.logs.join("\n"), /# My Spec/);
});

test("run() dispatches unknown commands with a nonzero exit code", () => {
  const capture = captureConsole();
  let exitCode;
  try {
    exitCode = run(["not-a-command"]);
  } finally {
    capture.restore();
  }
  assert.strictEqual(exitCode, 1);
});

test("run() with no command prints usage and exits 0", () => {
  const capture = captureConsole();
  let exitCode;
  try {
    exitCode = run([]);
  } finally {
    capture.restore();
  }
  assert.strictEqual(exitCode, 0);
});

test("run() approve command parses the --id option", () => {
  withTempDir((dir) => {
    cpSync(MODERNIZATION_DIR, dir, { recursive: true });
    const capture = captureConsole();
    let exitCode;
    try {
      exitCode = run(["approve", dir, "--id", "cli-parsed-id"]);
    } finally {
      capture.restore();
    }
    assert.strictEqual(exitCode, 0);
    const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
    assert.strictEqual(manifest.id, "cli-parsed-id");
  });
});
