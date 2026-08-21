namespace LegacyTradeReconciliation
{
    public static class BatchConfiguration
    {
        public const decimal PositionQuantityTolerance = 0.01m;
        public const decimal SettlementQuantityTolerance = 0.02m;
        public const decimal SettlementAmountTolerance = 5.00m;

        public const string TradesFileName = "trades.csv";
        public const string PositionsFileName = "positions.csv";
        public const string SettlementsFileName = "settlements.csv";
        public const string OverridesFileName = "overrides.csv";
        public const string MatchedTradesFileName = "matched-trades.csv";
        public const string BreakQueueFileName = "break-queue.csv";
        public const string EndOfDayReportFileName = "end-of-day-report.txt";
        public const string RunLedgerFileName = "run-ledger.csv";
    }
}
