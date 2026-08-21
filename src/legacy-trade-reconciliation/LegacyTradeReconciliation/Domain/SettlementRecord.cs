using System;

namespace LegacyTradeReconciliation.Domain
{
    public sealed class SettlementRecord
    {
        public string SettlementId { get; set; }
        public string Account { get; set; }
        public string Instrument { get; set; }
        public decimal Quantity { get; set; }
        public DateTime SettlementDate { get; set; }
        public string Currency { get; set; }
        public decimal CashAmount { get; set; }
    }
}
