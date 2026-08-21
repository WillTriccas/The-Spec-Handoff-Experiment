using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using TradeRecon.Application.Abstractions;
using TradeRecon.Application.Reconciliation;
using TradeRecon.Application.Reporting;
using TradeRecon.Domain;
using TradeRecon.Infrastructure.Persistence;
using TradeRecon.Infrastructure.Reporting;
using TradeRecon.Infrastructure.Sources;
using Xunit;

namespace TradeRecon.Tests;

public class JsonContractTests
{
    private static readonly DateOnly FixtureDate = new(2024, 6, 3);
    private static string FixturesDir => Path.Combine(AppContext.BaseDirectory, "fixtures");

    private static ReconciliationRunOptions StrictOptions() => new()
    {
        Tolerances = new ToleranceOptions
        {
            QuantityAbsolute = 0m,
            AmountAbsolute = 0.01m,
            SettlementDateDays = 0,
            PositionQuantityAbsolute = 0m
        }
    };

    [Fact]
    public void BuildJson_IsDeterministic_ForIdenticalInputs()
    {
        var batch = TestData.Batch(
            trades: new[] { TestData.Trade("T1"), TestData.Trade("T2", instrument: "INSTR2") },
            settlements: new[] { TestData.Settlement("S1", tradeId: "T1") });

        var engine = TestData.Engine();
        var builder = new EndOfDayReportBuilder();

        var json1 = builder.BuildJson(engine.Reconcile(batch, TestData.Options(reconcilePositions: false), TestData.NoOverrides));
        var json2 = builder.BuildJson(engine.Reconcile(batch, TestData.Options(reconcilePositions: false), TestData.NoOverrides));

        Assert.Equal(json1, json2);
    }

    [Fact]
    public void BuildJson_ContainsStableContract_Fields()
    {
        var batch = TestData.Batch(trades: new[] { TestData.Trade("T1") });
        var result = TestData.Engine().Reconcile(batch, TestData.Options(reconcilePositions: false), TestData.NoOverrides);

        var json = new EndOfDayReportBuilder().BuildJson(result);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.Equal("1.0", root.GetProperty("schemaVersion").GetString());
        Assert.Equal("2024-06-03", root.GetProperty("businessDate").GetString());
        Assert.Equal("BreaksOutstanding", root.GetProperty("status").GetString());
        Assert.Equal(1, root.GetProperty("openBreakCount").GetInt32());
        Assert.Equal("MissingSettlement", root.GetProperty("breaks")[0].GetProperty("type").GetString());
        Assert.Equal("Open", root.GetProperty("breaks")[0].GetProperty("status").GetString());
    }

    [Fact]
    public void CleanResult_SerialisesCleanStatus()
    {
        var batch = TestData.Batch(
            trades: new[] { TestData.Trade("T1") },
            settlements: new[] { TestData.Settlement("S1", tradeId: "T1") },
            positions: new[] { TestData.Position(netQuantity: 100m) });

        var result = TestData.Engine().Reconcile(batch, TestData.Options(), TestData.NoOverrides);
        var json = new EndOfDayReportBuilder().BuildJson(result);

        using var doc = JsonDocument.Parse(json);
        Assert.Equal("Clean", doc.RootElement.GetProperty("status").GetString());
        Assert.Equal(0, doc.RootElement.GetProperty("openBreakCount").GetInt32());
    }

    [Fact]
    public async Task Runner_WritesJsonResultFile_ThatParses()
    {
        var outputDir = Path.Combine(Path.GetTempPath(), "traderecon-json-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(outputDir);
        try
        {
            var runner = new ReconciliationRunner(
                new CsvReconciliationBatchSource(
                    new CsvBatchSourceOptions { FixturesDirectory = FixturesDir },
                    NullLogger<CsvReconciliationBatchSource>.Instance),
                new ReconciliationEngine(NullLogger<ReconciliationEngine>.Instance),
                new InMemoryReconciliationResultRepository(),
                new InMemoryManualOverrideStore(),
                new FileReportWriter(
                    new FileReportWriterOptions { OutputDirectory = outputDir },
                    NullLogger<FileReportWriter>.Instance),
                new EndOfDayReportBuilder(),
                NullLogger<ReconciliationRunner>.Instance);

            await runner.RunAsync(FixtureDate, StrictOptions());

            var jsonPath = Path.Combine(outputDir, "2024-06-03", "eod-result.json");
            Assert.True(File.Exists(jsonPath));

            var json = await File.ReadAllTextAsync(jsonPath);
            using var doc = JsonDocument.Parse(json);
            Assert.Equal(7, doc.RootElement.GetProperty("openBreakCount").GetInt32());
            Assert.Equal(2, doc.RootElement.GetProperty("matchCount").GetInt32());
        }
        finally
        {
            Directory.Delete(outputDir, recursive: true);
        }
    }

    [Fact]
    public async Task JsonResultFile_IsByteIdentical_AcrossReruns()
    {
        var outputDir = Path.Combine(Path.GetTempPath(), "traderecon-json-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(outputDir);
        try
        {
            IReportWriter writer = new FileReportWriter(
                new FileReportWriterOptions { OutputDirectory = outputDir },
                NullLogger<FileReportWriter>.Instance);
            var runner = new ReconciliationRunner(
                new CsvReconciliationBatchSource(
                    new CsvBatchSourceOptions { FixturesDirectory = FixturesDir },
                    NullLogger<CsvReconciliationBatchSource>.Instance),
                new ReconciliationEngine(NullLogger<ReconciliationEngine>.Instance),
                new InMemoryReconciliationResultRepository(),
                new InMemoryManualOverrideStore(),
                writer,
                new EndOfDayReportBuilder(),
                NullLogger<ReconciliationRunner>.Instance);

            var jsonPath = Path.Combine(outputDir, "2024-06-03", "eod-result.json");

            await runner.RunAsync(FixtureDate, StrictOptions());
            var first = await File.ReadAllTextAsync(jsonPath);

            await runner.RunAsync(FixtureDate, StrictOptions());
            var second = await File.ReadAllTextAsync(jsonPath);

            Assert.Equal(first, second);
        }
        finally
        {
            Directory.Delete(outputDir, recursive: true);
        }
    }
}
