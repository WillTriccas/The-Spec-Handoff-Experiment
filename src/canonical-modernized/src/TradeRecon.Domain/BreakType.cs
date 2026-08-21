namespace TradeRecon.Domain;

/// <summary>Classification of a reconciliation break.</summary>
public enum BreakType
{
    /// <summary>An internal trade has no corresponding settlement.</summary>
    MissingSettlement = 1,

    /// <summary>A settlement has no corresponding internal trade.</summary>
    MissingTrade = 2,

    /// <summary>Trade and settlement matched on key but quantities differ beyond tolerance.</summary>
    QuantityMismatch = 3,

    /// <summary>Trade and settlement matched on key but settlement dates differ beyond tolerance.</summary>
    SettlementDateMismatch = 4,

    /// <summary>Trade and settlement matched on key but amounts differ beyond tolerance.</summary>
    AmountMismatch = 5,

    /// <summary>Trade and settlement matched on key but direction (buy/sell) differs.</summary>
    DirectionMismatch = 6,

    /// <summary>Net of matched trades disagrees with the declared position snapshot.</summary>
    PositionMismatch = 7
}
