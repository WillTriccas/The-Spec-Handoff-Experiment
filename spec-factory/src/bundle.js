import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { STAGES } from "./stages.js";

/**
 * Load every stage file present in a bundle directory. Missing stage files
 * are simply omitted from the returned map so callers (validation, scoring)
 * can report them as absent rather than crashing.
 */
export function loadBundle(bundleDir) {
  const bundle = {};
  for (const stage of STAGES) {
    const filePath = path.join(bundleDir, stage.file);
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf8");
      try {
        bundle[stage.id] = JSON.parse(raw);
      } catch (error) {
        throw new Error(`Failed to parse ${filePath}: ${error.message}`);
      }
    }
  }
  return bundle;
}

export function bundleStagePath(bundleDir, stageId) {
  const stage = STAGES.find((entry) => entry.id === stageId);
  if (!stage) {
    throw new Error(`Unknown spec factory stage: ${stageId}`);
  }
  return path.join(bundleDir, stage.file);
}

export function writeStage(bundleDir, stageId, data) {
  const filePath = bundleStagePath(bundleDir, stageId);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return filePath;
}

/**
 * Assemble the full, human-readable spec document from the individual stage
 * files. This is the artifact that gets hashed and handed to spec-input
 * benchmark lanes.
 */
export function assembleSpec(bundle, meta = {}) {
  return {
    schemaVersion: "1.0.0",
    id: meta.id ?? null,
    title: meta.title ?? null,
    stages: STAGES.map((stage) => stage.id),
    ...bundle
  };
}

export function renderSpecMarkdown(bundle, meta = {}) {
  const lines = [];
  lines.push(`# ${meta.title ?? "Approved specification"}`);
  lines.push("");
  if (meta.id) {
    lines.push(`Spec ID: \`${meta.id}\``);
    lines.push("");
  }

  const intent = bundle.intent;
  if (intent) {
    lines.push("## Intent");
    lines.push("");
    lines.push(intent.problemStatement);
    lines.push("");
    lines.push("**Goals**");
    for (const goal of intent.goals ?? []) lines.push(`- ${goal}`);
    lines.push("");
    lines.push("**Non-goals**");
    for (const goal of intent.nonGoals ?? []) lines.push(`- ${goal}`);
    lines.push("");
    lines.push("**Success metrics**");
    for (const metric of intent.successMetrics ?? []) lines.push(`- ${metric}`);
    lines.push("");
    lines.push("**Stakeholders**");
    for (const stakeholder of intent.stakeholders ?? []) lines.push(`- ${stakeholder}`);
    lines.push("");
  }

  const discovery = bundle.discovery;
  if (discovery) {
    lines.push("## Brownfield discovery");
    lines.push("");
    lines.push(discovery.systemSummary);
    lines.push("");
    lines.push("**Components**");
    for (const c of discovery.components ?? []) lines.push(`- ${c}`);
    lines.push("");
    lines.push("**Data flows**");
    for (const d of discovery.dataFlows ?? []) lines.push(`- ${d}`);
    lines.push("");
    lines.push("**Constraints**");
    for (const c of discovery.constraints ?? []) lines.push(`- ${c}`);
    lines.push("");
    lines.push("**Known behaviors to preserve**");
    for (const b of discovery.knownBehaviors ?? []) lines.push(`- ${b}`);
    lines.push("");
  }

  const ambiguities = bundle.ambiguities;
  if (ambiguities) {
    lines.push("## Ambiguity and assumption review");
    lines.push("");
    for (const item of ambiguities.items ?? []) {
      lines.push(
        `- **[${item.severity}] ${item.id}** — ${item.description} → Resolution: ${item.resolution} (${item.status})`
      );
    }
    lines.push("");
  }

  const requirements = bundle.requirements;
  if (requirements) {
    lines.push("## Requirements");
    lines.push("");
    for (const r of requirements.items ?? []) {
      lines.push(`- **${r.id}** (testable=${r.testable}): ${r.statement}`);
    }
    lines.push("");
  }

  const invariants = bundle.invariants;
  if (invariants) {
    lines.push("## Domain invariants");
    lines.push("");
    for (const inv of invariants.items ?? []) {
      lines.push(`- **${inv.id}**: ${inv.statement} (_enforced at: ${inv.enforcementPoint}_)`);
    }
    lines.push("");
  }

  const nfrs = bundle.nfrs;
  if (nfrs) {
    lines.push("## Non-functional requirements");
    lines.push("");
    for (const n of nfrs.items ?? []) {
      lines.push(`- **${n.id}** [${n.category}]: ${n.statement} (target: ${n.target})`);
    }
    lines.push("");
  }

  const risks = bundle.risks;
  if (risks) {
    lines.push("## Risks");
    lines.push("");
    for (const risk of risks.items ?? []) {
      lines.push(
        `- **${risk.id}** (likelihood=${risk.likelihood}, impact=${risk.impact}): ${risk.description} — Mitigation: ${risk.mitigation}`
      );
    }
    lines.push("");
  }

  const acceptance = bundle.acceptanceCriteria;
  if (acceptance) {
    lines.push("## Acceptance criteria");
    lines.push("");
    for (const ac of acceptance.items ?? []) {
      lines.push(`- **${ac.id}** (${ac.requirementId}, testable=${ac.testable})`);
      lines.push(`  - Given ${ac.given}`);
      lines.push(`  - When ${ac.when}`);
      lines.push(`  - Then ${ac.then}`);
    }
    lines.push("");
  }

  const traceability = bundle.traceability;
  if (traceability) {
    lines.push("## Traceability");
    lines.push("");
    for (const link of traceability.links ?? []) {
      lines.push(
        `- ${link.requirementId} → acceptance: [${(link.acceptanceCriteriaIds ?? []).join(", ")}], invariants: [${(link.invariantIds ?? []).join(", ")}], risks: [${(link.riskIds ?? []).join(", ")}]`
      );
    }
    lines.push("");
  }

  const signoff = bundle.signoff;
  if (signoff) {
    lines.push("## Review and sign-off");
    lines.push("");
    lines.push(`Decision: **${signoff.decision}** on ${signoff.decidedAt}`);
    lines.push("");
    lines.push("**Authors**");
    for (const author of signoff.authors ?? []) {
      lines.push(`- ${author.name} (${author.role})`);
    }
    lines.push("");
    if (signoff.blindnessAttestation) {
      lines.push(
        `**Blindness attestation**: ${signoff.blindnessAttestation.attested ? "attested" : "NOT attested"} — ${signoff.blindnessAttestation.statement}`
      );
      lines.push("");
    }
    if (signoff.authoringEffort) {
      const effort = signoff.authoringEffort;
      lines.push(
        `**Authoring effort**: ${effort.elapsedMinutes} min, ${effort.uncachedInputTokens ?? effort.inputTokens ?? "n/a"} uncached input / ${effort.cachedInputTokens ?? "n/a"} cached input / ${effort.outputTokens ?? "n/a"} output / ${effort.reasoningTokens ?? "n/a"} reasoning tokens, cost ${effort.estimatedCostUsd ?? "not priced"}`
      );
      lines.push("");
    }
    lines.push("**Reviewers**");
    for (const reviewer of signoff.reviewers ?? []) {
      lines.push(`- ${reviewer.name} (${reviewer.role}): ${reviewer.verdict}`);
    }
    lines.push("");
    lines.push(signoff.notes);
    lines.push("");
  }

  return lines.join("\n");
}
