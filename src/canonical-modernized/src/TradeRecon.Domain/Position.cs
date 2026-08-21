namespace TradeRecon.Domain;

/// <summary>
/// An end-of-day position snapshot per account and instrument, as reported independently
/// (e.g. by the books-and-records system). Used to validate that the net of matched
/// trades agrees with the declared position.
/// </summary>
public sealed record Position
{
    public required string Account { get; init; }
    public required string Instrument { get; init; }
    public required string Currency { get; init; }

    /// <summary>Net (signed) quantity expected to be held at end of day.</summary>
    public required decimal NetQuantity { get; init; }
}
