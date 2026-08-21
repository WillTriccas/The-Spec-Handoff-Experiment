namespace TradeRecon.Domain;

/// <summary>
/// A single reconciliation break. Breaks are value objects: given identical inputs the
/// engine always produces the same set of breaks with the same <see cref="BreakKey"/>,
/// which is what makes reruns idempotent and manual overrides stable.
/// </summary>
public sealed record ReconciliationBreak
{
    public required DateOnly BusinessDate { get; init; }
    public required BreakType Type { get; init; }
    public required ReconciliationKey Key { get; init; }

    /// <summary>Internal trade identifier involved in the break, when applicable.</summary>
    public string? TradeId { get; init; }

    /// <summary>Settlement identifier involved in the break, when applicable.</summary>
    public string? SettlementId { get; init; }

    /// <summary>Human-readable description of the discrepancy (no sensitive PII).</summary>
    public required string Detail { get; init; }

    /// <summary>Magnitude of the discrepancy where meaningful (quantity, amount or days).</summary>
    public decimal? Difference { get; init; }

    public BreakStatus Status { get; init; } = BreakStatus.Open;

    /// <summary>
    /// Stable identity of the break, independent of mutable status. Two breaks describing
    /// the same discrepancy on the same business date share a break key.
    /// </summary>
    public string BreakKey => string.Join(
        '|',
        BusinessDate.ToString("yyyyMMdd"),
        Type,
        Key.ToString(),
        TradeId ?? "-",
        SettlementId ?? "-");
}
