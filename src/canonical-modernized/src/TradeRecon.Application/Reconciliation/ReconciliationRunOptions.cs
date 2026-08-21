using TradeRecon.Domain;

namespace TradeRecon.Application.Reconciliation;

/// <summary>Options controlling a single reconciliation run.</summary>
public sealed record ReconciliationRunOptions
{
    /// <summary>Matching tolerances. Defaults to a near-strict configuration.</summary>
    public ToleranceOptions Tolerances { get; init; } = new();

    /// <summary>
    /// When true, position snapshots are reconciled against the net of the day's trades.
    /// </summary>
    public bool ReconcilePositions { get; init; } = true;
}
