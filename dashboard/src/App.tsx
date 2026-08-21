import { useMemo, useState } from 'react';
import { AlertTriangle, Clock3, FileCheck2, Gauge, ShieldCheck } from 'lucide-react';
import experiment from '../../benchmark/config/experiment.json';
import evidence from '../../evidence/test-runs/2026-08-21-v1.0.0/manifest.json';
import type { EvidenceManifest, PlannedCell } from './types';

const manifest = evidence as EvidenceManifest;

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="badge badge-neutral">{children}</span>;
}

function CellTable({ cells }: { cells: PlannedCell[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Order</th>
          <th>Episode</th>
          <th>Lane</th>
          <th>Repetition</th>
          <th>Model</th>
          <th>Status</th>
          <th>Evidence</th>
        </tr>
      </thead>
      <tbody>
        {cells.map((cell) => (
          <tr key={cell.runId}>
            <td>{cell.executionOrder}</td>
            <td>{cell.episodeId}</td>
            <td><code>{cell.laneId}</code></td>
            <td>{cell.repetition}</td>
            <td>{cell.modelId}</td>
            <td><Badge>{cell.status}</Badge></td>
            <td><code>{cell.canonicalEvidencePath}</code></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function App() {
  const [view, setView] = useState<'executive' | 'engineering'>('executive');
  const [lane, setLane] = useState('all');
  const cells = useMemo(
    () => manifest.plannedCells.filter((cell) => lane === 'all' || cell.laneId === lane),
    [lane],
  );

  return (
    <div className="page-shell">
      <div className="evidence-banner">NOT-EVALUATED · NO MEASURED RUNS OR PERFORMANCE CLAIMS</div>
      <main className="dashboard-container">
        <header className="header">
          <div>
            <div className="eyebrow">The Spec Handoff Experiment</div>
            <h1>Can MAI implement the same Opus-authored spec with equivalent quality and fewer tokens?</h1>
            <p className="subtitle">
              A pre-registered 12-cell Financial Services benchmark. The framework is ready for
              independent specification authoring, but measured execution is intentionally blocked.
            </p>
          </div>
          <div className="view-toggle" aria-label="Dashboard view">
            <button className={view === 'executive' ? 'active' : ''} onClick={() => setView('executive')}>Executive</button>
            <button className={view === 'engineering' ? 'active' : ''} onClick={() => setView('engineering')}>Engineering</button>
          </div>
        </header>

        <section className="claim-hero">
          <div className="claim-status">
            <AlertTriangle className="status-inconclusive" size={24} />
            <div>
              <div className="eyebrow">Pre-registered headline hypothesis</div>
              <h2>not-evaluated</h2>
            </div>
          </div>
          <p>{manifest.hypothesis}</p>
          <div className="claim-badges">
            <Badge>Quality: not-evaluated</Badge>
            <Badge>Implementation tokens: not-evaluated</Badge>
            <Badge>Overall: weaker episode</Badge>
          </div>
        </section>

        <section className="metrics-grid" aria-label="Experiment summary">
          <article className="metric-card"><Gauge size={22} /><div><div className="metric-label">Planned cells</div><div className="metric-value">12</div><div className="metric-detail">2 episodes × 2 lanes × 3 repetitions</div></div></article>
          <article className="metric-card"><FileCheck2 size={22} /><div><div className="metric-label">Approved specs</div><div className="metric-value">0/2</div><div className="metric-detail">Real Opus-authored specs are still required</div></div></article>
          <article className="metric-card"><ShieldCheck size={22} /><div><div className="metric-label">Freeze status</div><div className="metric-value">Blocked</div><div className="metric-detail">Fails closed pending specs and approvals</div></div></article>
          <article className="metric-card"><Clock3 size={22} /><div><div className="metric-label">Run timeout</div><div className="metric-value">120 min</div><div className="metric-detail">Symmetric across both implementation models</div></div></article>
        </section>

        <section className="card comparison-card">
          <div className="section-heading">
            <div>
              <div className="eyebrow">Controlled comparison</div>
              <h2><code>mai-spec</code> versus <code>opus-spec</code></h2>
            </div>
            <Badge>Identical approved spec SHA-256 required</Badge>
          </div>
          <p>
            Both lanes receive only the task brief, immutable baseline, and the same approved
            content-addressed specification. Implementation conversations do not receive authoring
            transcripts, evaluator source, prior evidence, or cross-run memory.
          </p>
        </section>

        {view === 'engineering' && (
          <section className="card">
            <div className="section-heading">
              <div>
                <div className="eyebrow">Engineering view</div>
                <h2>Deterministic interleaved execution plan</h2>
              </div>
              <label>Lane
                <select value={lane} onChange={(event) => setLane(event.target.value)}>
                  <option value="all">All lanes</option>
                  <option value="opus-spec">opus-spec</option>
                  <option value="mai-spec">mai-spec</option>
                </select>
              </label>
            </div>
            <CellTable cells={cells} />
            <p>
              Token evidence will remain split into uncached input, cached input, output, and
              reasoning categories. Productive time remains separate from queue/throttle time.
            </p>
          </section>
        )}

        <footer>
          Benchmark {experiment.benchmarkVersion} · Evidence {manifest.version} · Status not-evaluated
        </footer>
      </main>
    </div>
  );
}
