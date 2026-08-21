namespace TradeRecon.Domain;

/// <summary>
/// Configurable matching tolerances. All comparisons that fall within these bounds are
/// treated as a match; anything outside produces a break. Tolerances are inclusive.
/// </summary>
public sealed record ToleranceOptions
{
    /// <summary>Absolute quantity difference permitted between trade and settlement.</summary>
    public decimal QuantityAbsolute { get; init; } = 0m;

    /// <summary>
    /// Relative quantity difference permitted, expressed as a fraction of the trade
    /// quantity (e.g. 0.01 = 1%). The effective quantity tolerance is the larger of the
    /// absolute and relative bounds.
    /// </summary>
    public decimal QuantityRelative { get; init; } = 0m;

    /// <summary>Absolute amount difference permitted between trade and settlement.</summary>
    public decimal AmountAbsolute { get; init; } = 0.01m;

    /// <summary>
    /// Relative amount difference permitted, expressed as a fraction of the trade amount.
    /// The effective amount tolerance is the larger of the absolute and relative bounds.
    /// </summary>
    public decimal AmountRelative { get; init; } = 0m;

    /// <summary>Number of calendar days the settlement date may differ (timing tolerance).</summary>
    public int SettlementDateDays { get; init; } = 0;

    /// <summary>Absolute net-quantity difference permitted during position reconciliation.</summary>
    public decimal PositionQuantityAbsolute { get; init; } = 0m;

    /// <summary>A strict configuration where any difference is a break.</summary>
    public static ToleranceOptions Strict { get; } = new()
    {
        QuantityAbsolute = 0m,
        QuantityRelative = 0m,
        AmountAbsolute = 0m,
        AmountRelative = 0m,
        SettlementDateDays = 0,
        PositionQuantityAbsolute = 0m
    };

    /// <summary>Effective absolute quantity tolerance for a given trade quantity.</summary>
    public decimal EffectiveQuantityTolerance(decimal referenceQuantity)
        => Math.Max(QuantityAbsolute, Math.Abs(referenceQuantity) * QuantityRelative);

    /// <summary>Effective absolute amount tolerance for a given trade amount.</summary>
    public decimal EffectiveAmountTolerance(decimal referenceAmount)
        => Math.Max(AmountAbsolute, Math.Abs(referenceAmount) * AmountRelative);
}
