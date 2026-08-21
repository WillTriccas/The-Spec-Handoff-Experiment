namespace TradeRecon.Domain;

/// <summary>
/// The complete set of inputs for a single reconciliation run: the internal trades, the
/// custodian settlements and the declared position snapshots for one business date.
/// </summary>
public sealed record ReconciliationBatch
{
    public required DateOnly BusinessDate { get; init; }
    public required IReadOnlyList<Trade> Trades { get; init; }
    public required IReadOnlyList<Settlement> Settlements { get; init; }
    public required IReadOnlyList<Position> Positions { get; init; }
}
