import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

export const SPEC_KIT_ARTIFACTS = Object.freeze([
  "constitution.md",
  "spec.md",
  "plan.md",
  "tasks.md",
  "analysis.md",
  "checklists/requirements.md"
]);

const PLACEHOLDER = /\[(?:FEATURE NAME|DATE|TASK BRIEF|TITLE|VALUE|OBSERVABLE TEST|CONTEXT|ACTION|OUTCOME|BOUNDARY OR FAILURE CASE|TESTABLE REQUIREMENT|ENTITY|MEANING AND RELATIONSHIPS|TECHNOLOGY-AGNOSTIC MEASURABLE OUTCOME|EXPLICIT ASSUMPTION|RESOLVED QUESTION AND ANSWER; NO OPEN CRITICAL ITEMS|PRIMARY REQUIREMENT AND TECHNICAL APPROACH|PASS\/FAIL WITH EVIDENCE FOR EACH CONSTITUTION PRINCIPLE|PASS\/FAIL FINDING FOR EACH PRINCIPLE|DECISIONS, ALTERNATIVES, AND RATIONALE|ENTITIES, STATE, VALIDATION, AND RELATIONSHIPS|EXTERNAL AND INTERNAL CONTRACT IMPACTS|END-TO-END VALIDATION PROCEDURE|CONCRETE REPOSITORY PATHS|CONCRETE SETUP TASK|FOUNDATIONAL TASK BLOCKING USER STORIES|GOAL|TEST|TEST TASK WITH PATH|IMPLEMENTATION TASK WITH PATH|SECURITY, OPERABILITY, AND FULL-SUITE VALIDATION|PHASE AND STORY DEPENDENCIES|TASKS SAFE TO EXECUTE IN PARALLEL|SECTION|CONFLICT, DUPLICATION, AMBIGUITY, OR NONE)\]/i;

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function loadSpecKitBundle(directory) {
  return Object.fromEntries(
    SPEC_KIT_ARTIFACTS.map((relativePath) => [
      relativePath,
      existsSync(path.join(directory, relativePath))
        ? readFileSync(path.join(directory, relativePath), "utf8")
        : null
    ])
  );
}

export function validateSpecKitBundle(bundle) {
  const errors = [];
  for (const artifact of SPEC_KIT_ARTIFACTS) {
    const content = bundle[artifact];
    if (typeof content !== "string" || content.trim().length === 0) {
      errors.push(`Missing Spec Kit artifact: ${artifact}`);
      continue;
    }
    if (PLACEHOLDER.test(content)) {
      errors.push(`Spec Kit artifact still contains template placeholders: ${artifact}`);
    }
  }
  const requiredSections = {
    "constitution.md": ["## Core Principles", "## Governance"],
    "spec.md": ["## User Scenarios & Testing", "## Requirements", "## Success Criteria"],
    "plan.md": ["## Technical Context", "## Constitution Check", "## Project Structure"],
    "tasks.md": ["## Phase 1:", "## Dependencies & Execution Order"],
    "analysis.md": ["## Constitution Compliance", "## Coverage", "## Unresolved Issues"],
    "checklists/requirements.md": ["## Specification Quality", "## Plan and Task Quality"]
  };
  for (const [artifact, sections] of Object.entries(requiredSections)) {
    const content = bundle[artifact] ?? "";
    for (const section of sections) {
      if (!content.includes(section)) {
        errors.push(`${artifact} is missing required section "${section}"`);
      }
    }
  }
  const checklist = bundle["checklists/requirements.md"] ?? "";
  if (/^- \[ \]/m.test(checklist)) {
    errors.push("Requirements-quality checklist contains unchecked items");
  }
  if (/NEEDS CLARIFICATION/i.test(bundle["spec.md"] ?? "")) {
    errors.push("Specification contains unresolved clarification markers");
  }
  if (!/T\d{3}/.test(bundle["tasks.md"] ?? "")) {
    errors.push("tasks.md contains no atomic Spec Kit task identifiers");
  }
  const unresolvedSection = sectionBody(
    bundle["analysis.md"] ?? "",
    "Unresolved Issues"
  );
  if (!/^None\.?$/i.test(unresolvedSection.trim())) {
    errors.push(
      "analysis.md Unresolved Issues section must contain only \"None.\""
    );
  }

  function sectionBody(markdown, heading) {
    const headingMatch = new RegExp(`^## ${heading}\\s*$`, "im").exec(markdown);
    if (!headingMatch) return "";
    const remaining = markdown.slice(
      headingMatch.index + headingMatch[0].length
    );
    const nextHeading = /^##\s/m.exec(remaining);
    return nextHeading ? remaining.slice(0, nextHeading.index) : remaining;
  }
  return { errors, valid: errors.length === 0 };
}

export function assembleSpecKitBundle(bundle, metadata = {}) {
  return {
    schemaVersion: "github-spec-kit-bundle/1.0.0",
    methodology: {
      repository: "https://github.com/github/spec-kit",
      commit: metadata.methodologyCommit,
      phases: [
        "constitution",
        "specify",
        "clarify",
        "plan",
        "checklist",
        "tasks",
        "analyze"
      ]
    },
    id: metadata.id ?? null,
    artifacts: Object.fromEntries(
      SPEC_KIT_ARTIFACTS.map((artifact) => [artifact, bundle[artifact]])
    )
  };
}

export function hashSpecKitBundle(bundle, metadata = {}) {
  return sha256(JSON.stringify(assembleSpecKitBundle(bundle, metadata)));
}

export function renderSpecKitBundle(bundle, metadata = {}) {
  const sections = [
    `# Approved GitHub Spec Kit handoff${metadata.id ? `: ${metadata.id}` : ""}`,
    "",
    ...SPEC_KIT_ARTIFACTS.flatMap((artifact) => [
      `---`,
      "",
      `## Artifact: \`${artifact}\``,
      "",
      bundle[artifact]?.trim() ?? "",
      ""
    ])
  ];
  return sections.join("\n");
}

export function approveSpecKitBundle(directory, {
  id,
  methodologyCommit,
  approvedAt,
  reviewer,
  author,
  authoringEffort
}) {
  const bundle = loadSpecKitBundle(directory);
  const validation = validateSpecKitBundle(bundle);
  if (!validation.valid) {
    throw new Error(`Spec Kit approval refused:\n${validation.errors.join("\n")}`);
  }
  for (const [field, value] of Object.entries({
    elapsedSeconds: authoringEffort?.elapsedSeconds,
    uncachedInputTokens: authoringEffort?.uncachedInputTokens,
    cachedInputTokens: authoringEffort?.cachedInputTokens,
    outputTokens: authoringEffort?.outputTokens,
    reasoningTokens: authoringEffort?.reasoningTokens
  })) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(
        `Spec Kit approval refused: authoringEffort.${field} must be a non-negative integer`
      );
    }
  }
  const metadata = { id, methodologyCommit };
  const manifest = {
    schemaVersion: "github-spec-kit-manifest/1.0.0",
    id,
    sha256: hashSpecKitBundle(bundle, metadata),
    qualityScore: 100,
    methodology: assembleSpecKitBundle(bundle, metadata).methodology,
    artifacts: Object.fromEntries(
      SPEC_KIT_ARTIFACTS.map((artifact) => [
        artifact,
        { sha256: sha256(bundle[artifact]) }
      ])
    ),
    approvedAt,
    reviewer,
    author,
    blindnessAttestation: {
      attested: true,
      statement: "The author had no access to sealed evaluator material, prior evidence, or expected results."
    },
    authoringEffort
  };
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  return manifest;
}
