using TradeRecon.Domain;

namespace TradeRecon.Application.Reconciliation;

/// <summary>
/// Pairs internal trades with custodian settlements that share a
/// <see cref="ReconciliationKey"/>. Pairing is deterministic: explicit trade-id links are
/// honoured first, then remaining records are paired positionally after a stable ordering.
/// The matcher only establishes candidate pairs; field-level tolerance checks are applied
/// by the engine.
/// </summary>
internal static class TradeSettlementMatcher
{
    internal sealed record MatchOutcome(
        IReadOnlyList<(Trade Trade, Settlement Settlement)> Pairs,
        IReadOnlyList<Trade> UnmatchedTrades,
        IReadOnlyList<Settlement> UnmatchedSettlements);

    internal static MatchOutcome Match(IReadOnlyList<Trade> trades, IReadOnlyList<Settlement> settlements)
    {
        var pairs = new List<(Trade, Settlement)>();

        var tradesByKey = trades
            .GroupBy(ReconciliationKey.FromTrade)
            .ToDictionary(g => g.Key, g => g.ToList());

        var settlementsByKey = settlements
            .GroupBy(ReconciliationKey.FromSettlement)
            .ToDictionary(g => g.Key, g => g.ToList());

        foreach (var key in AllKeys(tradesByKey, settlementsByKey))
        {
            var keyTrades = tradesByKey.TryGetValue(key, out var t)
                ? new List<Trade>(t)
                : new List<Trade>();
            var keySettlements = settlementsByKey.TryGetValue(key, out var s)
                ? new List<Settlement>(s)
                : new List<Settlement>();

            // Pass 1: honour explicit trade-id links.
            foreach (var settlement in keySettlements.ToList())
            {
                if (string.IsNullOrEmpty(settlement.TradeId))
                {
                    continue;
                }

                var linked = keyTrades.FirstOrDefault(tr =>
                    string.Equals(tr.TradeId, settlement.TradeId, StringComparison.Ordinal));
                if (linked is not null)
                {
                    pairs.Add((linked, settlement));
                    keyTrades.Remove(linked);
                    keySettlements.Remove(settlement);
                }
            }

            // Pass 2: pair the remainder positionally using a stable ordering.
            var orderedTrades = keyTrades.OrderBy(x => x, TradeOrder).ToList();
            var orderedSettlements = keySettlements.OrderBy(x => x, SettlementOrder).ToList();

            var count = Math.Min(orderedTrades.Count, orderedSettlements.Count);
            for (var i = 0; i < count; i++)
            {
                pairs.Add((orderedTrades[i], orderedSettlements[i]));
            }

            keyTrades = orderedTrades.Skip(count).ToList();
            keySettlements = orderedSettlements.Skip(count).ToList();

            tradesByKey[key] = keyTrades;
            settlementsByKey[key] = keySettlements;
        }

        var unmatchedTrades = tradesByKey.Values.SelectMany(x => x)
            .OrderBy(x => x, TradeOrder).ToList();
        var unmatchedSettlements = settlementsByKey.Values.SelectMany(x => x)
            .OrderBy(x => x, SettlementOrder).ToList();

        return new MatchOutcome(pairs, unmatchedTrades, unmatchedSettlements);
    }

    private static IEnumerable<ReconciliationKey> AllKeys(
        IReadOnlyDictionary<ReconciliationKey, List<Trade>> trades,
        IReadOnlyDictionary<ReconciliationKey, List<Settlement>> settlements)
        => trades.Keys.Concat(settlements.Keys)
            .Distinct()
            .OrderBy(k => k.ToString(), StringComparer.Ordinal);

    private static readonly IComparer<Trade> TradeOrder = Comparer<Trade>.Create((a, b) =>
    {
        var q = a.Quantity.CompareTo(b.Quantity);
        if (q != 0) return q;
        var d = a.SettlementDate.CompareTo(b.SettlementDate);
        if (d != 0) return d;
        return string.CompareOrdinal(a.TradeId, b.TradeId);
    });

    private static readonly IComparer<Settlement> SettlementOrder = Comparer<Settlement>.Create((a, b) =>
    {
        var q = a.Quantity.CompareTo(b.Quantity);
        if (q != 0) return q;
        var d = a.SettlementDate.CompareTo(b.SettlementDate);
        if (d != 0) return d;
        return string.CompareOrdinal(a.SettlementId, b.SettlementId);
    });
}
