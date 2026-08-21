// Ordered stage definitions for the guided spec factory workflow.
//
// Each stage maps to one JSON file in a spec bundle directory
// (`<bundleDir>/<stage.file>`). The CLI walks stages in order so that a
// reviewer is guided from intent framing through sign-off without skipping
// steps that later stages depend on (for example: requirements depend on
// discovery, acceptance criteria depend on requirements).

export const STAGES = [
  {
    id: "intent",
    file: "intent.json",
    title: "Intent framing",
    description:
      "Problem statement, goals, non-goals, success metrics and stakeholders.",
    requiredKeys: ["problemStatement", "goals", "nonGoals", "successMetrics", "stakeholders"]
  },
  {
    id: "discovery",
    file: "discovery.json",
    title: "Brownfield discovery import",
    description:
      "Facts imported from the existing system: components, data flows, constraints and known behaviors that any change must respect.",
    requiredKeys: ["systemSummary", "components", "dataFlows", "constraints", "knownBehaviors"]
  },
  {
    id: "ambiguities",
    file: "ambiguities.json",
    title: "Ambiguity and assumption review",
    description:
      "Every open question raised during discovery, its severity, and how it was resolved (or the assumption made). Critical ambiguities must be resolved before approval.",
    requiredKeys: ["items"]
  },
  {
    id: "requirements",
    file: "requirements.json",
    title: "Requirements",
    description:
      "Testable functional requirements. Every requirement must be marked testable=true before approval.",
    requiredKeys: ["items"]
  },
  {
    id: "invariants",
    file: "invariants.json",
    title: "Domain invariants",
    description:
      "Business rules that must hold true regardless of implementation, with the enforcement point in the system.",
    requiredKeys: ["items"]
  },
  {
    id: "nfrs",
    file: "nfrs.json",
    title: "Non-functional requirements",
    description:
      "Performance, reliability, security, observability and maintainability targets.",
    requiredKeys: ["items"]
  },
  {
    id: "risks",
    file: "risks.json",
    title: "Risks",
    description: "Delivery and operational risks with likelihood, impact and mitigation.",
    requiredKeys: ["items"]
  },
  {
    id: "acceptanceCriteria",
    file: "acceptance-criteria.json",
    title: "Acceptance criteria",
    description:
      "Given/When/Then scenarios tied to requirements. Every requirement needs at least one testable acceptance criterion.",
    requiredKeys: ["items"]
  },
  {
    id: "traceability",
    file: "traceability.json",
    title: "Traceability matrix",
    description:
      "Links from requirement to acceptance criteria, invariants and risks so coverage gaps are visible before approval.",
    requiredKeys: ["links"]
  },
  {
    id: "signoff",
    file: "signoff.json",
    title: "Review and sign-off",
    description:
      "Reviewer roster, decision, approval date, spec authorship, a blindness attestation that authors had no access to the benchmark's hidden evaluator rubric, and the effort spent authoring the spec.",
    requiredKeys: [
      "reviewers",
      "decision",
      "decidedAt",
      "notes",
      "authors",
      "blindnessAttestation",
      "authoringEffort"
    ]
  }
];

export const STAGE_IDS = STAGES.map((stage) => stage.id);

export function stageById(id) {
  const stage = STAGES.find((entry) => entry.id === id);
  if (!stage) {
    throw new Error(`Unknown spec factory stage: ${id}`);
  }
  return stage;
}
