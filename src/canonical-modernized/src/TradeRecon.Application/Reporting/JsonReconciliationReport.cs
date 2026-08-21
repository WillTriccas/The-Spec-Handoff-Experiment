namespace TradeRecon.Application.Reporting;

/// <summary>
/// Stable, machine-readable projection of a reconciliation result for black-box
/// evaluation. Property order and value formatting are deterministic; enums serialise as
/// their string names and monetary/quantity values use invariant formatting.
/// </summary>
public sealed record JsonReconciliationReport
{
    /// <summary>Schema version so external evaluators can pin their expectations.</summary>
    public required string SchemaVersion { get; init; }

    public required string BusinessDate { get; init; }

    /// <summary>Either <c>Clean</c> or <c>BreaksOutstanding</c>.</summary>
    public required string Status { get; init; }

    public required int TradeCount { get; init; }
    public required int SettlementCount { get; init; }
    public required int PositionCount { get; init; }
    public required int MatchCount { get; init; }
    public required int OpenBreakCount { get; init; }
    public required int OverriddenBreakCount { get; init; }

    /// <summary>Open-break counts keyed by break type name, ordered by type.</summary>
    public required IReadOnlyDictionary<string, int> OpenBreakCountsByType { get; init; }

    public required IReadOnlyList<JsonBreak> Breaks { get; init; }
    public required IReadOnlyList<JsonMatch> Matches { get; init; }
}

/// <summary>A single break in the machine-readable report.</summary>
public sealed record JsonBreak
{
    public required string BreakKey { get; init; }
    public required string Type { get; init; }
    public required string Status { get; init; }
    public required string Account { get; init; }
    public required string Instrument { get; init; }
    public required string Currency { get; init; }
    public string? TradeId { get; init; }
    public string? SettlementId { get; init; }
    public decimal? Difference { get; init; }
    public required string Detail { get; init; }
}

/// <summary>A single clean match in the machine-readable report.</summary>
public sealed record JsonMatch
{
    public required string Account { get; init; }
    public required string Instrument { get; init; }
    public required string Currency { get; init; }
    public required string TradeId { get; init; }
    public required string SettlementId { get; init; }
}
