using System;

namespace LegacyTradeReconciliation.Domain
{
    public sealed class PositionRecord
    {
        public string PositionId { get; set; }
        public string Account { get; set; }
        public string Instrument { get; set; }
        public decimal Quantity { get; set; }
        public DateTime SettlementDate { get; set; }
        public string Currency { get; set; }
    }
}
