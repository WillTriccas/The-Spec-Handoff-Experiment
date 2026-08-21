using TradeRecon.Domain;
using Xunit;

namespace TradeRecon.Tests;

public class OverrideAndIdempotencyTests
{
    [Fact]
    public void ManualOverride_SuppressesMatchingBreak()
    {
        var batch = TestData.Batch(trades: new[] { TestData.Trade("T1") });

        var initial = TestData.Engine().Reconcile(batch, TestData.Options(reconcilePositions: false), TestData.NoOverrides);
        var breakKey = Assert.Single(initial.Breaks).BreakKey;

        var overrides = new HashSet<string> { breakKey };
        var result = TestData.Engine().Reconcile(batch, TestData.Options(reconcilePositions: false), overrides);

        Assert.Empty(result.OpenBreaks);
        Assert.Single(result.OverriddenBreaks);
        Assert.True(result.IsClean);
    }

    [Fact]
    public void Override_DoesNotAffectUnrelatedBreaks()
    {
        var batch = TestData.Batch(
            trades: new[] { TestData.Trade("T1"), TestData.Trade("T2", instrument: "INSTR2") });

        var initial = TestData.Engine().Reconcile(batch, TestData.Options(reconcilePositions: false), TestData.NoOverrides);
        var firstKey = initial.Breaks[0].BreakKey;

        var result = TestData.Engine().Reconcile(
            batch,
            TestData.Options(reconcilePositions: false),
            new HashSet<string> { firstKey });

        Assert.Single(result.OverriddenBreaks);
        Assert.Single(result.OpenBreaks);
    }

    [Fact]
    public void Rerun_WithIdenticalInputs_IsDeterministic()
    {
        var batch = TestData.Batch(
            trades: new[]
            {
                TestData.Trade("T1"),
                TestData.Trade("T2", instrument: "INSTR2", quantity: 50m),
                TestData.Trade("T3", instrument: "INSTR3")
            },
            settlements: new[]
            {
                TestData.Settlement("S1", tradeId: "T1"),
                TestData.Settlement("S9", account: "ACC9", instrument: "INSTR9")
            });

        var engine = TestData.Engine();
        var first = engine.Reconcile(batch, TestData.Options(reconcilePositions: false), TestData.NoOverrides);
        var second = engine.Reconcile(batch, TestData.Options(reconcilePositions: false), TestData.NoOverrides);

        var firstKeys = first.Breaks.Select(b => b.BreakKey).ToList();
        var secondKeys = second.Breaks.Select(b => b.BreakKey).ToList();

        Assert.Equal(firstKeys, secondKeys);
        Assert.Equal(first.Matches.Count, second.Matches.Count);
    }

    [Fact]
    public void BreakKey_IsStableAcrossRuns_EnablingStableOverrides()
    {
        var batch = TestData.Batch(trades: new[] { TestData.Trade("T1") });

        var run1 = TestData.Engine().Reconcile(batch, TestData.Options(reconcilePositions: false), TestData.NoOverrides);
        var run2 = TestData.Engine().Reconcile(batch, TestData.Options(reconcilePositions: false), TestData.NoOverrides);

        Assert.Equal(run1.Breaks[0].BreakKey, run2.Breaks[0].BreakKey);
    }
}
