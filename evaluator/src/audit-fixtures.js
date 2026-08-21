import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256Object, sha256Text } from './hash.js';

export const AUDIT_RECONCILIATION_BUSINESS_DATE = '2026-02-17';

export const AUDIT_RECONCILIATION_FILES = Object.freeze({
  'trades.csv': [
    'BusinessDate,TradeId,Account,Instrument,Quantity,Direction,SettlementDate,Currency,Amount',
    '2026-02-17,T001,ACC001,GB00B03MLX29,1000,BUY,2026-02-19,GBP,15250.00',
    '2026-02-17,T002,ACC001,US0378331005,500,SELL,2026-02-19,USD,95000.00',
    '2026-02-17,T003,ACC002,DE0005140008,2000,BUY,2026-02-18,EUR,44000.00',
    '2026-02-17,T004,ACC002,FR0000131104,300,SELL,2026-02-19,EUR,6600.00',
    '2026-02-17,T005,ACC003,JP3633400001,800,BUY,2026-02-19,JPY,1600000',
    '2026-02-17,T006,ACC003,CH0038863350,150,SELL,2026-02-19,CHF,3000.00',
    '2026-02-17,T007,ACC001,NL0000235190,400,BUY,2026-02-19,EUR,8000.00',
    ''
  ].join('\n'),
  'settlements.csv': [
    'BusinessDate,SettlementId,TradeId,Account,Instrument,Quantity,Direction,SettlementDate,Currency,Amount',
    '2026-02-17,S001,T001,ACC001,GB00B03MLX29,1000,BUY,2026-02-19,GBP,15250.00',
    '2026-02-17,S002,T002,ACC001,US0378331005,500,SELL,2026-02-19,USD,95000.01',
    '2026-02-17,S003,T003,ACC002,DE0005140008,1900,BUY,2026-02-18,EUR,44000.00',
    '2026-02-17,S004,T004,ACC002,FR0000131104,300,SELL,2026-02-20,EUR,6600.00',
    '2026-02-17,S005,T005,ACC003,JP3633400001,800,BUY,2026-02-19,JPY,1600500',
    '2026-02-17,S006,T006,ACC003,CH0038863350,150,BUY,2026-02-19,CHF,3000.00',
    '2026-02-17,S008,,ACC002,SE0000108656,700,BUY,2026-02-19,SEK,52500.00',
    ''
  ].join('\n'),
  'positions.csv': [
    'BusinessDate,Account,Instrument,Currency,NetQuantity',
    '2026-02-17,ACC001,GB00B03MLX29,GBP,1000',
    '2026-02-17,ACC001,US0378331005,USD,-500',
    '2026-02-17,ACC002,DE0005140008,EUR,2000',
    '2026-02-17,ACC002,FR0000131104,EUR,-300',
    '2026-02-17,ACC003,JP3633400001,JPY,900',
    '2026-02-17,ACC003,CH0038863350,CHF,-150',
    '2026-02-17,ACC001,NL0000235190,EUR,400',
    ''
  ].join('\n')
});

export async function writeAuditReconciliationFixture(directory) {
  await fs.mkdir(directory, { recursive: true });
  await Promise.all(
    Object.entries(AUDIT_RECONCILIATION_FILES).map(([name, content]) =>
      fs.writeFile(path.join(directory, name), content)
    )
  );
}

export function auditReconciliationFixtureHashes() {
  return {
    businessDate: AUDIT_RECONCILIATION_BUSINESS_DATE,
    files: Object.fromEntries(
      Object.entries(AUDIT_RECONCILIATION_FILES).map(([name, content]) => [
        name,
        sha256Text(content)
      ])
    ),
    fixtureSetHash: sha256Object(AUDIT_RECONCILIATION_FILES),
    id: 'audit-reconciliation-canonical-2026-08-21',
    format: 'canonical-modernized-pascal-case-csv'
  };
}
