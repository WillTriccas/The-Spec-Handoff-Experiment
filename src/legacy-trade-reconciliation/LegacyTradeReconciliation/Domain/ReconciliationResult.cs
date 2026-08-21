using System.Collections.Generic;

namespace LegacyTradeReconciliation.Domain
{
    public sealed class ReconciliationResult
    {
        public List<MatchedTradeRecord> MatchedTrades { get; set; }
        public List<BreakRecord> OpenBreaks { get; set; }
        public List<ManualOverrideRecord> StaleOverrides { get; set; }
        public int TotalTradesRead { get; set; }
        public int CanonicalTradeCount { get; set; }
        public int DuplicateTradeCount { get; set; }
        public int MatchedCount { get; set; }
        public int ManualOverrideMatchedCount { get; set; }
        public int ManualOverrideSuppressedCount { get; set; }
    }
}
