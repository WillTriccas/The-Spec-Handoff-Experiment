using Microsoft.Extensions.Logging.Abstractions;
using TradeRecon.Application.Reconciliation;
using TradeRecon.Domain;

namespace TradeRecon.Tests;

/// <summary>Shared helpers for constructing deterministic reconciliation inputs.</summary>
internal static class TestData
{
    public static readonly DateOnly Date = new(2024, 6, 3);

    public static ReconciliationEngine Engine() => new(NullLogger<ReconciliationEngine>.Instance);

    public static Trade Trade(
        string tradeId,
        string account = "ACC001",
        string instrument = "INSTR1",
        decimal quantity = 100m,
        TradeDirection direction = TradeDirection.Buy,
        DateOnly? settlementDate = null,
        string currency = "USD",
        decimal amount = 1000m)
        => new()
        {
            TradeId = tradeId,
            Account = account,
            Instrument = instrument,
            Quantity = quantity,
            Direction = direction,
            SettlementDate = settlementDate ?? Date.AddDays(2),
            Currency = currency,
            Amount = amount
        };

    public static Settlement Settlement(
        string settlementId,
        string? tradeId = null,
        string account = "ACC001",
        string instrument = "INSTR1",
        decimal quantity = 100m,
        TradeDirection direction = TradeDirection.Buy,
        DateOnly? settlementDate = null,
        string currency = "USD",
        decimal amount = 1000m)
        => new()
        {
            SettlementId = settlementId,
            TradeId = tradeId,
            Account = account,
            Instrument = instrument,
            Quantity = quantity,
            Direction = direction,
            SettlementDate = settlementDate ?? Date.AddDays(2),
            Currency = currency,
            Amount = amount
        };

    public static Position Position(
        string account = "ACC001",
        string instrument = "INSTR1",
        string currency = "USD",
        decimal netQuantity = 100m)
        => new()
        {
            Account = account,
            Instrument = instrument,
            Currency = currency,
            NetQuantity = netQuantity
        };

    public static ReconciliationBatch Batch(
        IEnumerable<Trade>? trades = null,
        IEnumerable<Settlement>? settlements = null,
        IEnumerable<Position>? positions = null)
        => new()
        {
            BusinessDate = Date,
            Trades = (trades ?? Array.Empty<Trade>()).ToList(),
            Settlements = (settlements ?? Array.Empty<Settlement>()).ToList(),
            Positions = (positions ?? Array.Empty<Position>()).ToList()
        };

    public static ReconciliationRunOptions Options(ToleranceOptions? tolerances = null, bool reconcilePositions = true)
        => new()
        {
            Tolerances = tolerances ?? ToleranceOptions.Strict,
            ReconcilePositions = reconcilePositions
        };

    public static readonly IReadOnlySet<string> NoOverrides = new HashSet<string>();
}
