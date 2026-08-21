namespace TradeRecon.Domain;

/// <summary>
/// A simple manual override instruction: suppress the break identified by
/// <see cref="BreakKey"/> for the given business date. This is a lightweight operational
/// control (e.g. a known custodian timing difference) and deliberately carries no
/// approval workflow or audit trail.
/// </summary>
public sealed record ManualOverride
{
    public required string BreakKey { get; init; }
    public required DateOnly BusinessDate { get; init; }

    /// <summary>Optional short free-text note. Never used to gate the override.</summary>
    public string? Note { get; init; }
}
