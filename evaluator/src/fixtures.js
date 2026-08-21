import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256Object, sha256Text } from './hash.js';

export const MODERNIZATION_BUSINESS_DATE = '2026-02-17';

const MODERNIZATION_FILES = Object.freeze({
  'trades.csv': [
    'trade_id,account,instrument,quantity,settlement_date,currency,net_amount',
    ' t-norm , acc-mixed , gilt-1 ,100,2026-02-19, gbp ,1000.00',
    'T-DUP,ACC-DUP,IBM.N,10,2026-02-19,USD,250.00',
    'T-DUP,ACC-DUP,IBM.N,10,2026-02-19,USD,250.00',
    'T-TOL-IN,ACC-TOL,MSFT.OQ,50,2026-02-19,USD,1000.00',
    'T-TOL-OUT,ACC-TOL,TSLA.OQ,12,2026-02-19,USD,1000.00',
    'T-MISSING-SET,ACC-MISS,ORCL.N,7,2026-02-19,USD,700.00',
    'T-MISSING-POS,ACC-NOPOS,SAP.DE,8,2026-02-19,EUR,800.00',
    'T-NONPOS,ACC-BAD,NVDA.OQ,0,2026-02-19,USD,0.00',
    'T-OVR,ACC-OVR,VOD.L,90,2026-02-19,GBP,900.00',
    'T-OVR-DUP,ACC-OVR,RIO.L,80,2026-02-19,GBP,800.00',
    ''
  ].join('\n'),
  'positions.csv': [
    'position_id,account,instrument,quantity,settlement_date,currency',
    'P-NORM,ACC-MIXED,GILT-1,100,2026-02-19,GBP',
    'P-DUP,ACC-DUP,IBM.N,10,2026-02-19,USD',
    'P-TOL-IN,ACC-TOL,MSFT.OQ,50.01,2026-02-19,USD',
    'P-TOL-OUT,ACC-TOL,TSLA.OQ,12,2026-02-19,USD',
    'P-MISSING-SET,ACC-MISS,ORCL.N,7,2026-02-19,USD',
    'P-NONPOS,ACC-BAD,NVDA.OQ,1,2026-02-19,USD',
    'P-OVR,ACC-OVR,VOD.L,90,2026-02-19,GBP',
    'P-OVR-DUP,ACC-OVR,RIO.L,80,2026-02-19,GBP',
    ''
  ].join('\n'),
  'settlements.csv': [
    'settlement_id,account,instrument,quantity,settlement_date,currency,cash_amount',
    'S-NORM,ACC-MIXED,GILT-1,100,2026-02-19,GBP,1000.00',
    'S-DUP,ACC-DUP,IBM.N,10,2026-02-19,USD,250.00',
    'S-TOL-IN,ACC-TOL,MSFT.OQ,50.02,2026-02-19,USD,1005.00',
    'S-TOL-OUT,ACC-TOL,TSLA.OQ,12,2026-02-19,USD,1005.01',
    'S-MISSING-POS,ACC-NOPOS,SAP.DE,8,2026-02-19,EUR,800.00',
    'S-NONPOS,ACC-BAD,NVDA.OQ,1,2026-02-19,USD,1.00',
    'S-OVR,ACC-OVR,VOD.L,90,2026-02-19,GBP,906.00',
    'S-OVR-DUP,ACC-OVR,RIO.L,80,2026-02-19,GBP,806.00',
    ''
  ].join('\n'),
  'overrides.csv': [
    'trade_id,action,note,approved_by',
    'T-OVR,SuppressBreak,synthetic approved suppression,ops-lead',
    'T-OVR-DUP,ForceMatch,synthetic first approval,ops-lead',
    'T-OVR-DUP,SuppressBreak,synthetic duplicate approval,ops-backup',
    'T-MISSING-SET,ForceMatch,cannot manufacture settlement,ops-lead',
    ''
  ].join('\n')
});

export async function writeModernizationFixture(directory) {
  await fs.mkdir(directory, { recursive: true });
  await Promise.all(Object.entries(MODERNIZATION_FILES).map(([name, content]) => fs.writeFile(path.join(directory, name), content)));
}

export function fixtureHashes() {
  return {
    modernization: {
      businessDate: MODERNIZATION_BUSINESS_DATE,
      files: Object.fromEntries(Object.entries(MODERNIZATION_FILES).map(([name, content]) => [name, sha256Text(content)])),
      fixtureSetHash: sha256Object(MODERNIZATION_FILES),
      id: 'modernization-hidden-synthetic-2026-08-12',
      format: 'legacy-observable-csv-contract'
    },
    auditFeature: {
      fixtureSetHash: sha256Object(AUDIT_SYNTHETIC_VALUES),
      id: 'audit-hidden-synthetic-2026-08-12',
      format: 'adapter-placeholder-command-contract'
    }
  };
}

export const AUDIT_SYNTHETIC_VALUES = Object.freeze({
  accountSentinel: 'ACCT-SENTINEL-9f6e3a21',
  amountSentinel: '9876543.21',
  proposer: 'maker.alpha@example.test',
  approver: 'checker.beta@example.test',
  otherApprover: 'checker.gamma@example.test',
  date: '2026-02-17',
  reason: 'synthetic policy exception reason',
  evidence: 'synthetic-evidence-ticket-42'
});
