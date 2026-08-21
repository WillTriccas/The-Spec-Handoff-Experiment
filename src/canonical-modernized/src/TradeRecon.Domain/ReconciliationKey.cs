namespace TradeRecon.Domain;

/// <summary>
/// The natural key on which trades and settlements are matched: account, instrument and
/// currency. Quantity, settlement date and amount are then compared within tolerance for
/// records sharing a key.
/// </summary>
public readonly record struct ReconciliationKey(string Account, string Instrument, string Currency)
{
    public static ReconciliationKey FromTrade(Trade trade)
        => new(trade.Account, trade.Instrument, trade.Currency);

    public static ReconciliationKey FromSettlement(Settlement settlement)
        => new(settlement.Account, settlement.Instrument, settlement.Currency);

    public override string ToString() => $"{Account}|{Instrument}|{Currency}";
}
