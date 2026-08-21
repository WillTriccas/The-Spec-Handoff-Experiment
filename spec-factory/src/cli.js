import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STAGES } from "./stages.js";
import { loadBundle, bundleStagePath, assembleSpec, renderSpecMarkdown } from "./bundle.js";
import { validateBundle, isApprovable } from "./validate.js";
import { scoreBundle } from "./scoring.js";
import { hashBundle } from "./hashing.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "templates");

function printUsage() {
  console.log(`spec-factory <command> [options]

Commands:
  init <dir>              Scaffold blank stage templates in <dir>
  validate <dir>          Validate structural completeness and critical blocks
  score <dir>             Compute the quality score for a spec bundle
  approve <dir>           Validate + score, then write manifest.json if approvable
  hash <dir>              Print the sha256 of the assembled spec bundle
  render <dir>            Render the assembled spec bundle to Markdown
  stages                  List the guided workflow stages in order
`);
}

export function cmdStages() {
  for (const stage of STAGES) {
    console.log(`${stage.id.padEnd(20)} ${stage.title}`);
  }
  return 0;
}

export function cmdInit(bundleDir) {
  mkdirSync(bundleDir, { recursive: true });
  for (const stage of STAGES) {
    const dest = bundleStagePath(bundleDir, stage.id);
    if (existsSync(dest)) continue;
    const templatePath = path.join(TEMPLATES_DIR, stage.file);
    const template = readFileSync(templatePath, "utf8");
    writeFileSync(dest, template, "utf8");
    console.log(`created ${dest}`);
  }
  return 0;
}

export function cmdValidate(bundleDir) {
  const bundle = loadBundle(bundleDir);
  const { errors, criticalBlocks } = validateBundle(bundle);
  if (errors.length === 0 && criticalBlocks.length === 0) {
    console.log("Bundle is structurally valid with no critical blocks.");
    return 0;
  }
  for (const err of errors) console.error(`ERROR: ${err}`);
  for (const block of criticalBlocks) console.error(`BLOCKING: ${block}`);
  return 1;
}

export function cmdScore(bundleDir) {
  const bundle = loadBundle(bundleDir);
  const result = scoreBundle(bundle);
  console.log(JSON.stringify(result, null, 2));
  return result.blocked ? 1 : 0;
}

export function cmdApprove(bundleDir, { id } = {}) {
  const manifestPath = path.join(bundleDir, "manifest.json");
  rmSync(manifestPath, { force: true });
  const bundle = loadBundle(bundleDir);
  const { errors, criticalBlocks } = validateBundle(bundle);
  const scoreResult = scoreBundle(bundle);

  if (errors.length > 0 || criticalBlocks.length > 0) {
    for (const err of errors) console.error(`ERROR: ${err}`);
    for (const block of criticalBlocks) console.error(`BLOCKING: ${block}`);
    console.error("Approval refused: bundle has structural errors or critical blocks.");
    return 1;
  }

  if (bundle.signoff.decision !== "approved") {
    console.error(
      `Approval refused: signoff.decision is "${bundle.signoff.decision}", expected "approved".`
    );
    return 1;
  }

  const specId = id ?? path.basename(path.resolve(bundleDir));
  const assembled = assembleSpec(bundle, { id: specId });
  const sha256 = hashBundle(assembled);

  const manifest = {
    schemaVersion: "1.0.0",
    id: specId,
    sha256,
    qualityScore: scoreResult.score,
    dimensions: scoreResult.dimensions,
    approvedAt: bundle.signoff.decidedAt,
    reviewers: bundle.signoff.reviewers,
    authors: bundle.signoff.authors,
    blindnessAttestation: bundle.signoff.blindnessAttestation,
    authoringEffort: bundle.signoff.authoringEffort
  };

  writeFileSync(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  console.log(JSON.stringify(manifest, null, 2));
  return 0;
}

export function cmdHash(bundleDir, { id } = {}) {
  const bundle = loadBundle(bundleDir);
  const specId = id ?? path.basename(path.resolve(bundleDir));
  const assembled = assembleSpec(bundle, { id: specId });
  console.log(hashBundle(assembled));
  return 0;
}

export function cmdRender(bundleDir, { id, title } = {}) {
  const bundle = loadBundle(bundleDir);
  const specId = id ?? path.basename(path.resolve(bundleDir));
  console.log(renderSpecMarkdown(bundle, { id: specId, title }));
  return 0;
}

function parseOptions(args) {
  const positional = [];
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = args[i + 1];
      options[key] = value;
      i += 1;
    } else {
      positional.push(arg);
    }
  }
  return { positional, options };
}

export function run(argv) {
  const [command, ...rest] = argv;
  const { positional, options } = parseOptions(rest);
  switch (command) {
    case "stages":
      return cmdStages();
    case "init":
      if (!positional[0]) { console.error("Usage: spec-factory init <dir>"); return 1; }
      return cmdInit(positional[0]);
    case "validate":
      if (!positional[0]) { console.error("Usage: spec-factory validate <dir>"); return 1; }
      return cmdValidate(positional[0]);
    case "score":
      if (!positional[0]) { console.error("Usage: spec-factory score <dir>"); return 1; }
      return cmdScore(positional[0]);
    case "approve":
      if (!positional[0]) { console.error("Usage: spec-factory approve <dir> [--id <id>]"); return 1; }
      return cmdApprove(positional[0], options);
    case "hash":
      if (!positional[0]) { console.error("Usage: spec-factory hash <dir> [--id <id>]"); return 1; }
      return cmdHash(positional[0], options);
    case "render":
      if (!positional[0]) { console.error("Usage: spec-factory render <dir> [--id <id>] [--title <title>]"); return 1; }
      return cmdRender(positional[0], options);
    default:
      printUsage();
      return command ? 1 : 0;
  }
}

export { isApprovable };
