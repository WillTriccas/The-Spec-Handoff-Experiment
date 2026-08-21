using TradeRecon.Domain;
using Xunit;

namespace TradeRecon.Tests;

public class ToleranceTests
{
    [Fact]
    public void QuantityWithinAbsoluteTolerance_IsClean()
    {
        var batch = TestData.Batch(
            trades: new[] { TestData.Trade("T1", quantity: 100m) },
            settlements: new[] { TestData.Settlement("S1", tradeId: "T1", quantity: 101m) });

        var tolerances = new ToleranceOptions { QuantityAbsolute = 1m };
        var result = TestData.Engine().Reconcile(batch, TestData.Options(tolerances, reconcilePositions: false), TestData.NoOverrides);

        Assert.Single(result.Matches);
        Assert.Empty(result.OpenBreaks);
    }

    [Fact]
    public void QuantityBeyondTolerance_ProducesQuantityMismatch()
    {
        var batch = TestData.Batch(
            trades: new[] { TestData.Trade("T1", quantity: 100m) },
            settlements: new[] { TestData.Settlement("S1", tradeId: "T1", quantity: 102m) });

        var tolerances = new ToleranceOptions { QuantityAbsolute = 1m };
        var result = TestData.Engine().Reconcile(batch, TestData.Options(tolerances, reconcilePositions: false), TestData.NoOverrides);

        var brk = Assert.Single(result.OpenBreaks);
        Assert.Equal(BreakType.QuantityMismatch, brk.Type);
        Assert.Equal(2m, brk.Difference);
    }

    [Fact]
    public void QuantityRelativeTolerance_UsesLargerBound()
    {
        var batch = TestData.Batch(
            trades: new[] { TestData.Trade("T1", quantity: 1000m) },
            settlements: new[] { TestData.Settlement("S1", tradeId: "T1", quantity: 1005m) });

        // 0.5% of 1000 = 5, so a diff of 5 is within tolerance.
        var tolerances = new ToleranceOptions { QuantityRelative = 0.005m };
        var result = TestData.Engine().Reconcile(batch, TestData.Options(tolerances, reconcilePositions: false), TestData.NoOverrides);

        Assert.Single(result.Matches);
        Assert.Empty(result.OpenBreaks);
    }

    [Fact]
    public void AmountBeyondTolerance_ProducesAmountMismatch()
    {
        var batch = TestData.Batch(
            trades: new[] { TestData.Trade("T1", amount: 1000m) },
            settlements: new[] { TestData.Settlement("S1", tradeId: "T1", amount: 1000.50m) });

        var tolerances = new ToleranceOptions { AmountAbsolute = 0.01m };
        var result = TestData.Engine().Reconcile(batch, TestData.Options(tolerances, reconcilePositions: false), TestData.NoOverrides);

        var brk = Assert.Single(result.OpenBreaks);
        Assert.Equal(BreakType.AmountMismatch, brk.Type);
    }

    [Fact]
    public void SettlementDateWithinDayTolerance_IsClean()
    {
        var batch = TestData.Batch(
            trades: new[] { TestData.Trade("T1", settlementDate: TestData.Date.AddDays(2)) },
            settlements: new[] { TestData.Settlement("S1", tradeId: "T1", settlementDate: TestData.Date.AddDays(3)) });

        var tolerances = new ToleranceOptions { SettlementDateDays = 1 };
        var result = TestData.Engine().Reconcile(batch, TestData.Options(tolerances, reconcilePositions: false), TestData.NoOverrides);

        Assert.Single(result.Matches);
        Assert.Empty(result.OpenBreaks);
    }

    [Fact]
    public void SettlementDateBeyondTolerance_ProducesDateMismatch()
    {
        var batch = TestData.Batch(
            trades: new[] { TestData.Trade("T1", settlementDate: TestData.Date.AddDays(2)) },
            settlements: new[] { TestData.Settlement("S1", tradeId: "T1", settlementDate: TestData.Date.AddDays(4)) });

        var tolerances = new ToleranceOptions { SettlementDateDays = 1 };
        var result = TestData.Engine().Reconcile(batch, TestData.Options(tolerances, reconcilePositions: false), TestData.NoOverrides);

        var brk = Assert.Single(result.OpenBreaks);
        Assert.Equal(BreakType.SettlementDateMismatch, brk.Type);
        Assert.Equal(2m, brk.Difference);
    }
}
