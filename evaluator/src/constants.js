export const EVALUATOR_VERSION = '1.0.0';
export const EVIDENCE_SCHEMA_VERSION = 'sealed-evaluator-evidence/1.0.0';
export const MANIFEST_SCHEMA_VERSION = 'sealed-evaluator-manifest/1.0.0';

export const EPISODES = Object.freeze({
  modernization: 'modernization',
  auditFeature: 'audit-feature'
});

export const TIMEOUTS_MS = Object.freeze({
  build: 120_000,
  test: 120_000,
  run: 60_000,
  auditCommand: 15_000,
  restore: 120_000,
  scanner: 30_000
});

export const DIMENSIONS = Object.freeze([
  'functionalCorrectness',
  'behaviorPreservation',
  'securityControls',
  'maintainability',
  'operability',
  'scopeTraceability'
]);

export const SCORING_WEIGHTS = Object.freeze({
  functionalCorrectness: 35,
  behaviorPreservation: 20,
  securityControls: 15,
  maintainability: 15,
  operability: 10,
  scopeTraceability: 5
});

export const SCANNER_RULESETS = Object.freeze([
  {
    id: 'static-secret-patterns',
    version: '2026.08.12'
  },
  {
    id: 'static-unsafe-execution-deserialization',
    version: '2026.08.12'
  },
  {
    id: 'dependency-vulnerability-command-output',
    version: '2026.08.12'
  }
]);

export const MODERNIZATION_GATES = Object.freeze([
  'build',
  'essential-business-invariants',
  'no-critical-security-findings'
]);

export const AUDIT_GATES = Object.freeze([
  'build',
  'essential-business-invariants',
  'maker-checker-separation',
  'audit-integrity',
  'no-critical-security-findings'
]);
