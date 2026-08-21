using TradeRecon.Domain;
using Xunit;

namespace TradeRecon.Tests;

public class MatchingTests
{
    [Fact]
    public void ExactMatch_ProducesCleanPair_NoBreaks()
    {
        var batch = TestData.Batch(
            trades: new[] { TestData.Trade("T1") },
            settlements: new[] { TestData.Settlement("S1", tradeId: "T1") });

        var result = TestData.Engine().Reconcile(batch, TestData.Options(), TestData.NoOverrides);

        Assert.Single(result.Matches);
        Assert.Empty(result.OpenBreaks);
        Assert.True(result.IsClean);
    }

    [Fact]
    public void TradeWithoutSettlement_ProducesMissingSettlementBreak()
    {
        var batch = TestData.Batch(trades: new[] { TestData.Trade("T1") });

        var result = TestData.Engine().Reconcile(batch, TestData.Options(), TestData.NoOverrides);

        var brk = Assert.Single(result.OpenBreaks);
        Assert.Equal(BreakType.MissingSettlement, brk.Type);
        Assert.Equal("T1", brk.TradeId);
    }

    [Fact]
    public void SettlementWithoutTrade_ProducesMissingTradeBreak()
    {
        var batch = TestData.Batch(settlements: new[] { TestData.Settlement("S1") });

        var result = TestData.Engine().Reconcile(batch, TestData.Options(), TestData.NoOverrides);

        var brk = Assert.Single(result.OpenBreaks);
        Assert.Equal(BreakType.MissingTrade, brk.Type);
        Assert.Equal("S1", brk.SettlementId);
    }

    [Fact]
    public void MatchesByKey_WhenNoExplicitTradeIdLink()
    {
        var batch = TestData.Batch(
            trades: new[] { TestData.Trade("T1") },
            settlements: new[] { TestData.Settlement("S1") });

        var result = TestData.Engine().Reconcile(batch, TestData.Options(), TestData.NoOverrides);

        Assert.Single(result.Matches);
        Assert.Empty(result.OpenBreaks);
    }

    [Fact]
    public void MultipleTradesSameKey_PairDeterministically()
    {
        var trades = new[]
        {
            TestData.Trade("T1", quantity: 100m, amount: 1000m),
            TestData.Trade("T2", quantity: 200m, amount: 2000m)
        };
        var settlements = new[]
        {
            TestData.Settlement("S1", quantity: 200m, amount: 2000m),
            TestData.Settlement("S2", quantity: 100m, amount: 1000m)
        };

        var batch = TestData.Batch(trades: trades, settlements: settlements, positions: new[]
        {
            TestData.Position(netQuantity: 300m)
        });

        var result = TestData.Engine().Reconcile(batch, TestData.Options(), TestData.NoOverrides);

        Assert.Equal(2, result.Matches.Count);
        Assert.True(result.IsClean);
    }

    [Fact]
    public void DirectionMismatch_IsFlagged()
    {
        var batch = TestData.Batch(
            trades: new[] { TestData.Trade("T1", direction: TradeDirection.Buy) },
            settlements: new[] { TestData.Settlement("S1", tradeId: "T1", direction: TradeDirection.Sell) });

        var result = TestData.Engine().Reconcile(batch, TestData.Options(reconcilePositions: false), TestData.NoOverrides);

        var brk = Assert.Single(result.OpenBreaks);
        Assert.Equal(BreakType.DirectionMismatch, brk.Type);
    }
}
