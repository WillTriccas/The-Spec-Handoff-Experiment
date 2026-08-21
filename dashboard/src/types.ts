export type PlannedCell = {
  runId: string;
  episodeId: 'modernization' | 'audit-feature';
  laneId: 'opus-raw' | 'mai-spec';
  repetition: 1 | 2 | 3;
  executionOrder: number;
  modelId: 'claude-opus-5' | 'mai-code-1.1-flash';
  status: 'not-evaluated';
  canonicalEvidencePath: string;
};

export type EvidenceManifest = {
  schemaVersion: 'test-run-evidence-manifest/2.0.0';
  version: string;
  status: 'not-evaluated';
  hypothesis: string;
  plannedCells: PlannedCell[];
};
