using System;

namespace LegacyTradeReconciliation.Domain
{
    public sealed class BreakRecord
    {
        public string TradeId { get; set; }
        public string Account { get; set; }
        public string Instrument { get; set; }
        public decimal Quantity { get; set; }
        public DateTime SettlementDate { get; set; }
        public string Currency { get; set; }
        public string Reasons { get; set; }
        public string PositionId { get; set; }
        public string SettlementId { get; set; }
        public bool CanManualOverride { get; set; }
    }
}
