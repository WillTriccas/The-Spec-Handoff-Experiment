using TradeRecon.Domain;
using Xunit;

namespace TradeRecon.Tests;

public class PositionReconciliationTests
{
    [Fact]
    public void DeclaredPositionMatchesTradeNet_IsClean()
    {
        var batch = TestData.Batch(
            trades: new[] { TestData.Trade("T1", quantity: 100m, direction: TradeDirection.Buy) },
            settlements: new[] { TestData.Settlement("S1", tradeId: "T1") },
            positions: new[] { TestData.Position(netQuantity: 100m) });

        var result = TestData.Engine().Reconcile(batch, TestData.Options(), TestData.NoOverrides);

        Assert.True(result.IsClean);
    }

    [Fact]
    public void SellReducesNet_PositionReconciles()
    {
        var trades = new[]
        {
            TestData.Trade("T1", quantity: 300m, direction: TradeDirection.Buy),
            TestData.Trade("T2", quantity: 100m, direction: TradeDirection.Sell)
        };
        var settlements = new[]
        {
            TestData.Settlement("S1", quantity: 300m, direction: TradeDirection.Buy),
            TestData.Settlement("S2", quantity: 100m, direction: TradeDirection.Sell)
        };

        var batch = TestData.Batch(trades, settlements, new[] { TestData.Position(netQuantity: 200m) });

        var result = TestData.Engine().Reconcile(batch, TestData.Options(), TestData.NoOverrides);

        Assert.True(result.IsClean);
    }

    [Fact]
    public void DeclaredPositionDisagrees_ProducesPositionMismatch()
    {
        var batch = TestData.Batch(
            trades: new[] { TestData.Trade("T1", quantity: 100m, direction: TradeDirection.Buy) },
            settlements: new[] { TestData.Settlement("S1", tradeId: "T1") },
            positions: new[] { TestData.Position(netQuantity: 150m) });

        var result = TestData.Engine().Reconcile(batch, TestData.Options(), TestData.NoOverrides);

        var brk = Assert.Single(result.OpenBreaks, b => b.Type == BreakType.PositionMismatch);
        Assert.Equal(50m, brk.Difference);
    }

    [Fact]
    public void PositionReconciliation_CanBeDisabled()
    {
        var batch = TestData.Batch(
            trades: new[] { TestData.Trade("T1", quantity: 100m) },
            settlements: new[] { TestData.Settlement("S1", tradeId: "T1") },
            positions: new[] { TestData.Position(netQuantity: 999m) });

        var result = TestData.Engine().Reconcile(batch, TestData.Options(reconcilePositions: false), TestData.NoOverrides);

        Assert.DoesNotContain(result.Breaks, b => b.Type == BreakType.PositionMismatch);
    }
}
