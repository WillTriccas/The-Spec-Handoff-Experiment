using System.Globalization;
using Microsoft.Extensions.Logging;
using TradeRecon.Domain;

namespace TradeRecon.Application.Reconciliation;

/// <summary>
/// Default deterministic reconciliation engine. See the README for the full set of
/// business invariants this implements.
/// </summary>
public sealed class ReconciliationEngine : IReconciliationEngine
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    private readonly ILogger<ReconciliationEngine> _logger;

    public ReconciliationEngine(ILogger<ReconciliationEngine> logger)
    {
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public ReconciliationResult Reconcile(
        ReconciliationBatch batch,
        ReconciliationRunOptions options,
        IReadOnlySet<string> overriddenBreakKeys)
    {
        ArgumentNullException.ThrowIfNull(batch);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(overriddenBreakKeys);

        var tolerances = options.Tolerances;
        var matches = new List<MatchedPair>();
        var breaks = new List<ReconciliationBreak>();

        var outcome = TradeSettlementMatcher.Match(batch.Trades, batch.Settlements);

        foreach (var (trade, settlement) in outcome.Pairs)
        {
            var key = ReconciliationKey.FromTrade(trade);
            var pairBreaks = ComparePair(batch.BusinessDate, key, trade, settlement, tolerances);
            if (pairBreaks.Count == 0)
            {
                matches.Add(new MatchedPair { Trade = trade, Settlement = settlement, Key = key });
            }
            else
            {
                breaks.AddRange(pairBreaks);
            }
        }

        foreach (var trade in outcome.UnmatchedTrades)
        {
            breaks.Add(new ReconciliationBreak
            {
                BusinessDate = batch.BusinessDate,
                Type = BreakType.MissingSettlement,
                Key = ReconciliationKey.FromTrade(trade),
                TradeId = trade.TradeId,
                Detail = $"Trade {trade.TradeId} has no matching settlement.",
                Difference = trade.Quantity
            });
        }

        foreach (var settlement in outcome.UnmatchedSettlements)
        {
            breaks.Add(new ReconciliationBreak
            {
                BusinessDate = batch.BusinessDate,
                Type = BreakType.MissingTrade,
                Key = ReconciliationKey.FromSettlement(settlement),
                SettlementId = settlement.SettlementId,
                Detail = $"Settlement {settlement.SettlementId} has no matching trade.",
                Difference = settlement.Quantity
            });
        }

        if (options.ReconcilePositions)
        {
            breaks.AddRange(ReconcilePositions(batch, tolerances));
        }

        var finalisedBreaks = breaks
            .Select(b => overriddenBreakKeys.Contains(b.BreakKey)
                ? b with { Status = BreakStatus.Overridden }
                : b)
            .OrderBy(b => b.Type)
            .ThenBy(b => b.Key.ToString(), StringComparer.Ordinal)
            .ThenBy(b => b.TradeId ?? string.Empty, StringComparer.Ordinal)
            .ThenBy(b => b.SettlementId ?? string.Empty, StringComparer.Ordinal)
            .ToList();

        var orderedMatches = matches
            .OrderBy(m => m.Key.ToString(), StringComparer.Ordinal)
            .ThenBy(m => m.Trade.TradeId, StringComparer.Ordinal)
            .ToList();

        var openCount = finalisedBreaks.Count(b => b.Status == BreakStatus.Open);
        _logger.LogInformation(
            "Reconciled {BusinessDate}: {Trades} trades, {Settlements} settlements, {Positions} positions -> {Matches} matched, {OpenBreaks} open breaks, {OverriddenBreaks} overridden.",
            batch.BusinessDate,
            batch.Trades.Count,
            batch.Settlements.Count,
            batch.Positions.Count,
            orderedMatches.Count,
            openCount,
            finalisedBreaks.Count - openCount);

        return new ReconciliationResult
        {
            BusinessDate = batch.BusinessDate,
            Matches = orderedMatches,
            Breaks = finalisedBreaks,
            TradeCount = batch.Trades.Count,
            SettlementCount = batch.Settlements.Count,
            PositionCount = batch.Positions.Count
        };
    }

    private static List<ReconciliationBreak> ComparePair(
        DateOnly businessDate,
        ReconciliationKey key,
        Trade trade,
        Settlement settlement,
        ToleranceOptions tolerances)
    {
        var result = new List<ReconciliationBreak>();

        if (trade.Direction != settlement.Direction)
        {
            result.Add(new ReconciliationBreak
            {
                BusinessDate = businessDate,
                Type = BreakType.DirectionMismatch,
                Key = key,
                TradeId = trade.TradeId,
                SettlementId = settlement.SettlementId,
                Detail = $"Direction differs: trade {trade.Direction} vs settlement {settlement.Direction}."
            });
        }

        var quantityDiff = Math.Abs(trade.Quantity - settlement.Quantity);
        if (quantityDiff > tolerances.EffectiveQuantityTolerance(trade.Quantity))
        {
            result.Add(new ReconciliationBreak
            {
                BusinessDate = businessDate,
                Type = BreakType.QuantityMismatch,
                Key = key,
                TradeId = trade.TradeId,
                SettlementId = settlement.SettlementId,
                Detail = $"Quantity differs by {quantityDiff.ToString(Inv)} "
                         + $"(trade {trade.Quantity.ToString(Inv)}, settlement {settlement.Quantity.ToString(Inv)}).",
                Difference = quantityDiff
            });
        }

        var dayDiff = Math.Abs(trade.SettlementDate.DayNumber - settlement.SettlementDate.DayNumber);
        if (dayDiff > tolerances.SettlementDateDays)
        {
            result.Add(new ReconciliationBreak
            {
                BusinessDate = businessDate,
                Type = BreakType.SettlementDateMismatch,
                Key = key,
                TradeId = trade.TradeId,
                SettlementId = settlement.SettlementId,
                Detail = $"Settlement date differs by {dayDiff.ToString(Inv)} day(s) "
                         + $"(trade {trade.SettlementDate:yyyy-MM-dd}, settlement {settlement.SettlementDate:yyyy-MM-dd}).",
                Difference = dayDiff
            });
        }

        var amountDiff = Math.Abs(trade.Amount - settlement.Amount);
        if (amountDiff > tolerances.EffectiveAmountTolerance(trade.Amount))
        {
            result.Add(new ReconciliationBreak
            {
                BusinessDate = businessDate,
                Type = BreakType.AmountMismatch,
                Key = key,
                TradeId = trade.TradeId,
                SettlementId = settlement.SettlementId,
                Detail = $"Amount differs by {amountDiff.ToString(Inv)} "
                         + $"(trade {trade.Amount.ToString(Inv)}, settlement {settlement.Amount.ToString(Inv)}).",
                Difference = amountDiff
            });
        }

        return result;
    }

    private static IEnumerable<ReconciliationBreak> ReconcilePositions(
        ReconciliationBatch batch,
        ToleranceOptions tolerances)
    {
        var tradeNetByKey = batch.Trades
            .GroupBy(ReconciliationKey.FromTrade)
            .ToDictionary(g => g.Key, g => g.Sum(t => t.SignedQuantity));

        foreach (var position in batch.Positions
                     .OrderBy(p => $"{p.Account}|{p.Instrument}|{p.Currency}", StringComparer.Ordinal))
        {
            var key = new ReconciliationKey(position.Account, position.Instrument, position.Currency);
            var computedNet = tradeNetByKey.TryGetValue(key, out var net) ? net : 0m;
            var diff = Math.Abs(position.NetQuantity - computedNet);

            if (diff > tolerances.PositionQuantityAbsolute)
            {
                yield return new ReconciliationBreak
                {
                    BusinessDate = batch.BusinessDate,
                    Type = BreakType.PositionMismatch,
                    Key = key,
                    Detail = $"Declared position {position.NetQuantity.ToString(Inv)} "
                             + $"differs from trade-derived net {computedNet.ToString(Inv)} by {diff.ToString(Inv)}.",
                    Difference = diff
                };
            }
        }
    }
}
