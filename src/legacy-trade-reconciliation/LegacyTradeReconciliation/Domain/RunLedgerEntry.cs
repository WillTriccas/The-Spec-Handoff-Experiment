using System;

namespace LegacyTradeReconciliation.Domain
{
    public sealed class RunLedgerEntry
    {
        public DateTime BusinessDate { get; set; }
        public string InputSignature { get; set; }
        public int TotalTradesRead { get; set; }
        public int OpenBreakCount { get; set; }
        public int MatchedCount { get; set; }
    }
}
