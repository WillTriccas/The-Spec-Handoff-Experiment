import { AUDIT_GATES, DIMENSIONS, EVALUATOR_VERSION, EVIDENCE_SCHEMA_VERSION, MODERNIZATION_GATES, SCANNER_RULESETS, SCORING_WEIGHTS } from './constants.js';
import { fixtureHashes } from './fixtures.js';

export function createBaseEvidence(episodeId) {
  const gates = Object.fromEntries((episodeId === 'audit-feature' ? AUDIT_GATES : MODERNIZATION_GATES).map((id) => [
    id,
    {
      applicable: true,
      passed: false,
      findings: []
    }
  ]));

  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    evaluator: {
      name: 'sealed-ai-sdlc-benchmark-evaluator',
      version: EVALUATOR_VERSION,
      scannerRulesets: SCANNER_RULESETS,
      commandTimeoutsMs: {
        build: 120000,
        test: 120000,
        run: 60000,
        auditCommand: 15000,
        scanner: 30000
      },
      fixtureHashes: fixtureHashes(),
      blindnessAttestation: 'Evaluator used only allowed public contracts, prompts, scoring config, and source baselines; it remained blind to spec-factory/, evidence/, approved spec content, and expected measured benchmark output.'
    },
    episodeId,
    outcome: 'failed',
    score: 0,
    dimensions: Object.fromEntries(DIMENSIONS.map((dimension) => [
      dimension,
      {
        weight: SCORING_WEIGHTS[dimension],
        score: 0,
        passed: false,
        findings: []
      }
    ])),
    gates,
    commands: [],
    adapterValidation: {
      passed: false,
      errors: []
    },
    staticChecks: {
      blockingFindings: 0,
      criticalFindings: 0,
      findings: [],
      dependencyAuditCommands: []
    }
  };
}

export function finalizeEvidence(evidence) {
  const dimensionScores = Object.values(evidence.dimensions).reduce((sum, dimension) => sum + dimension.score, 0);
  const allGatesPassed = Object.values(evidence.gates).every((gate) => !gate.applicable || gate.passed);
  evidence.score = allGatesPassed ? dimensionScores : 0;
  evidence.outcome = evidence.score > 0 && allGatesPassed ? 'passed' : 'failed';
  return evidence;
}

export function passDimension(evidence, dimension, finding) {
  evidence.dimensions[dimension].passed = true;
  evidence.dimensions[dimension].score = evidence.dimensions[dimension].weight;
  if (finding) {
    evidence.dimensions[dimension].findings.push(finding);
  }
}

export function failDimension(evidence, dimension, finding) {
  evidence.dimensions[dimension].passed = false;
  evidence.dimensions[dimension].score = 0;
  if (finding) {
    evidence.dimensions[dimension].findings.push(finding);
  }
}

export function setGate(evidence, gateId, passed, finding) {
  if (!evidence.gates[gateId]) {
    evidence.gates[gateId] = {
      applicable: true,
      passed: false,
      findings: []
    };
  }
  evidence.gates[gateId].passed = passed;
  if (finding) {
    evidence.gates[gateId].findings.push(finding);
  }
}
