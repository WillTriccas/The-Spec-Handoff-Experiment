namespace TradeRecon.Domain;

/// <summary>
/// The immutable outcome of a reconciliation run for a single business date. Reruns for
/// the same date and inputs produce an equivalent result (idempotency).
/// </summary>
public sealed record ReconciliationResult
{
    public required DateOnly BusinessDate { get; init; }
    public required IReadOnlyList<MatchedPair> Matches { get; init; }
    public required IReadOnlyList<ReconciliationBreak> Breaks { get; init; }

    public int TradeCount { get; init; }
    public int SettlementCount { get; init; }
    public int PositionCount { get; init; }

    /// <summary>Breaks that remain open (not overridden).</summary>
    public IReadOnlyList<ReconciliationBreak> OpenBreaks
        => Breaks.Where(b => b.Status == BreakStatus.Open).ToList();

    /// <summary>Breaks that were suppressed via manual override.</summary>
    public IReadOnlyList<ReconciliationBreak> OverriddenBreaks
        => Breaks.Where(b => b.Status == BreakStatus.Overridden).ToList();

    public bool IsClean => OpenBreaks.Count == 0;
}
