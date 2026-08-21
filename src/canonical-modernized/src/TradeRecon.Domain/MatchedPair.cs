namespace TradeRecon.Domain;

/// <summary>
/// A pairing of an internal trade with its matched settlement, produced when both records
/// share a <see cref="ReconciliationKey"/> and all compared fields fall within tolerance.
/// </summary>
public sealed record MatchedPair
{
    public required Trade Trade { get; init; }
    public required Settlement Settlement { get; init; }
    public required ReconciliationKey Key { get; init; }
}
