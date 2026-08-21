namespace TradeRecon.Domain;

/// <summary>
/// A trade as recorded on the firm's internal books. This is the "our records" side of
/// the reconciliation. Quantity is expressed as a signed value derived from
/// <see cref="Direction"/> (Buy is positive, Sell is negative) via <see cref="SignedQuantity"/>.
/// </summary>
public sealed record Trade
{
    public required string TradeId { get; init; }
    public required string Account { get; init; }
    public required string Instrument { get; init; }

    /// <summary>Absolute traded quantity. Must be greater than zero.</summary>
    public required decimal Quantity { get; init; }

    public required TradeDirection Direction { get; init; }

    /// <summary>Contractual settlement date (value date) for the trade.</summary>
    public required DateOnly SettlementDate { get; init; }

    /// <summary>ISO 4217 currency code, upper-cased.</summary>
    public required string Currency { get; init; }

    /// <summary>Gross settlement amount in <see cref="Currency"/>. Must be greater than zero.</summary>
    public required decimal Amount { get; init; }

    /// <summary>Signed quantity where Sell reduces and Buy increases the position.</summary>
    public decimal SignedQuantity => Direction == TradeDirection.Sell ? -Quantity : Quantity;
}
