namespace LegacyTradeReconciliation.Domain
{
    public sealed class ManualOverrideRecord
    {
        public string TradeId { get; set; }
        public string Action { get; set; }
        public string Note { get; set; }
        public string ApprovedBy { get; set; }
    }
}
