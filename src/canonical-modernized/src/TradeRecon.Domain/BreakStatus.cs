namespace TradeRecon.Domain;

/// <summary>Lifecycle status of a reconciliation break.</summary>
public enum BreakStatus
{
    /// <summary>Detected by the engine and not yet actioned.</summary>
    Open = 1,

    /// <summary>Manually suppressed by an operator for this run (e.g. known timing difference).</summary>
    Overridden = 2
}
