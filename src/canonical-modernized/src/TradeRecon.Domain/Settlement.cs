namespace TradeRecon.Domain;

/// <summary>
/// A settlement confirmation received from the custodian / counterparty. This is the
/// "their records" side of the reconciliation. Each settlement is expected to correspond
/// to exactly one internal <see cref="Trade"/>.
/// </summary>
public sealed record Settlement
{
    public required string SettlementId { get; init; }

    /// <summary>The internal trade identifier the custodian references, when provided.</summary>
    public string? TradeId { get; init; }

    public required string Account { get; init; }
    public required string Instrument { get; init; }

    /// <summary>Absolute settled quantity. Must be greater than zero.</summary>
    public required decimal Quantity { get; init; }

    public required TradeDirection Direction { get; init; }

    /// <summary>Actual settlement date reported by the custodian.</summary>
    public required DateOnly SettlementDate { get; init; }

    /// <summary>ISO 4217 currency code, upper-cased.</summary>
    public required string Currency { get; init; }

    /// <summary>Gross settled amount in <see cref="Currency"/>. Must be greater than zero.</summary>
    public required decimal Amount { get; init; }

    public decimal SignedQuantity => Direction == TradeDirection.Sell ? -Quantity : Quantity;
}
