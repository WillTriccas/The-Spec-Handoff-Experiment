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

public class FixtureEndToEndTests
{
    private static readonly DateOnly FixtureDate = new(2024, 6, 3);

    private static string FixturesDir => Path.Combine(AppContext.BaseDirectory, "fixtures");

    private static ReconciliationRunner BuildRunner(string outputDir, out IManualOverrideStore overrides)
    {
        var source = new CsvReconciliationBatchSource(
            new CsvBatchSourceOptions { FixturesDirectory = FixturesDir },
            NullLogger<CsvReconciliationBatchSource>.Instance);
        var engine = new ReconciliationEngine(NullLogger<ReconciliationEngine>.Instance);
        var repository = new InMemoryReconciliationResultRepository();
        overrides = new InMemoryManualOverrideStore();
        var writer = new FileReportWriter(
            new FileReportWriterOptions { OutputDirectory = outputDir },
            NullLogger<FileReportWriter>.Instance);

        return new ReconciliationRunner(
            source,
            engine,
            repository,
            overrides,
            writer,
            new EndOfDayReportBuilder(),
            NullLogger<ReconciliationRunner>.Instance);
    }

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
    public async Task Fixtures_ProduceExpectedBreakProfile()
    {
        var outputDir = NewTempDir();
        try
        {
            var runner = BuildRunner(outputDir, out _);
            var result = await runner.RunAsync(FixtureDate, StrictOptions());

            // Two clean matches (T001/S001 exact, T002/S002 within amount tolerance).
            Assert.Equal(2, result.Matches.Count);

            var byType = result.OpenBreaks
                .GroupBy(b => b.Type)
                .ToDictionary(g => g.Key, g => g.Count());

            Assert.Equal(1, byType[BreakType.QuantityMismatch]);
            Assert.Equal(1, byType[BreakType.SettlementDateMismatch]);
            Assert.Equal(1, byType[BreakType.AmountMismatch]);
            Assert.Equal(1, byType[BreakType.DirectionMismatch]);
            Assert.Equal(1, byType[BreakType.MissingSettlement]);
            Assert.Equal(1, byType[BreakType.MissingTrade]);
            Assert.Equal(1, byType[BreakType.PositionMismatch]);
            Assert.Equal(7, result.OpenBreaks.Count);
            Assert.False(result.IsClean);
        }
        finally
        {
            Directory.Delete(outputDir, recursive: true);
        }
    }

    [Fact]
    public async Task Rerun_IsIdempotent_ForReportsAndBreakKeys()
    {
        var outputDir = NewTempDir();
        try
        {
            var runner = BuildRunner(outputDir, out _);

            var first = await runner.RunAsync(FixtureDate, StrictOptions());
            var firstRegister = await File.ReadAllTextAsync(RegisterPath(outputDir));

            var second = await runner.RunAsync(FixtureDate, StrictOptions());
            var secondRegister = await File.ReadAllTextAsync(RegisterPath(outputDir));

            Assert.Equal(
                first.Breaks.Select(b => b.BreakKey),
                second.Breaks.Select(b => b.BreakKey));
            Assert.Equal(firstRegister, secondRegister);
        }
        finally
        {
            Directory.Delete(outputDir, recursive: true);
        }
    }

    [Fact]
    public async Task ManualOverride_SuppressesBreakOnRerun()
    {
        var outputDir = NewTempDir();
        try
        {
            var runner = BuildRunner(outputDir, out var overrides);
            var initial = await runner.RunAsync(FixtureDate, StrictOptions());

            var missing = initial.OpenBreaks.First(b => b.Type == BreakType.MissingSettlement);
            await overrides.AddAsync(new ManualOverride
            {
                BreakKey = missing.BreakKey,
                BusinessDate = FixtureDate,
                Note = "known custodian timing difference"
            });

            var rerun = await runner.RunAsync(FixtureDate, StrictOptions());

            Assert.Equal(initial.OpenBreaks.Count - 1, rerun.OpenBreaks.Count);
            Assert.Contains(rerun.OverriddenBreaks, b => b.BreakKey == missing.BreakKey);
        }
        finally
        {
            Directory.Delete(outputDir, recursive: true);
        }
    }

    [Fact]
    public async Task Reports_AreWrittenToDisk()
    {
        var outputDir = NewTempDir();
        try
        {
            var runner = BuildRunner(outputDir, out _);
            await runner.RunAsync(FixtureDate, StrictOptions());

            var dateDir = Path.Combine(outputDir, "2024-06-03");
            Assert.True(File.Exists(Path.Combine(dateDir, "eod-summary.txt")));
            Assert.True(File.Exists(Path.Combine(dateDir, "eod-break-register.csv")));

            var summary = await File.ReadAllTextAsync(Path.Combine(dateDir, "eod-summary.txt"));
            Assert.Contains("BREAKS OUTSTANDING", summary);
        }
        finally
        {
            Directory.Delete(outputDir, recursive: true);
        }
    }

    private static string RegisterPath(string outputDir)
        => Path.Combine(outputDir, "2024-06-03", "eod-break-register.csv");

    private static string NewTempDir()
    {
        var dir = Path.Combine(Path.GetTempPath(), "traderecon-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        return dir;
    }
}
