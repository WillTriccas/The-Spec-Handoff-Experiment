using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using TradeRecon.Application.Reconciliation;
using TradeRecon.Domain;
using TradeRecon.Infrastructure.Persistence;
using TradeRecon.Infrastructure.Sources;

var options = ParseArguments(args);
if (options is null)
{
    return 1;
}

try
{
    var source = new CsvReconciliationBatchSource(
        new CsvBatchSourceOptions { FixturesDirectory = options.FixturesDirectory },
        NullLogger<CsvReconciliationBatchSource>.Instance);
    var batch = await source.LoadAsync(options.BusinessDate);
    var engine = new ReconciliationEngine(NullLogger<ReconciliationEngine>.Instance);
    var store = new InMemoryManualOverrideStore();
    var runOptions = new ReconciliationRunOptions
    {
        Tolerances = new ToleranceOptions
        {
            QuantityAbsolute = 0m,
            AmountAbsolute = 0.01m,
            SettlementDateDays = 0,
            PositionQuantityAbsolute = 0m
        },
        ReconcilePositions = true
    };

    var initial = engine.Reconcile(
        batch,
        runOptions,
        await store.GetOverriddenBreakKeysAsync(options.BusinessDate));
    var target = initial.OpenBreaks.FirstOrDefault(
        candidate => candidate.Type == BreakType.MissingSettlement);
    var failures = new List<string>();
    if (target is null)
    {
        failures.Add("canonical fixture did not produce a MissingSettlement break");
    }
    else
    {
        await store.AddAsync(new ManualOverride
        {
            BreakKey = target.BreakKey,
            BusinessDate = options.BusinessDate,
            Note = "sealed evaluator override suppression check"
        });
    }

    var overrideKeys = await store.GetOverriddenBreakKeysAsync(options.BusinessDate);
    var rerun = engine.Reconcile(batch, runOptions, overrideKeys);
    var repeated = engine.Reconcile(batch, runOptions, overrideKeys);
    var suppressed = target is null
        ? null
        : rerun.Breaks.SingleOrDefault(candidate => candidate.BreakKey == target.BreakKey);

    if (target is not null && suppressed?.Status != BreakStatus.Overridden)
    {
        failures.Add("seeded manual override did not mark the target break Overridden");
    }
    if (target is not null && rerun.OpenBreaks.Count != initial.OpenBreaks.Count - 1)
    {
        failures.Add("seeded manual override did not reduce open breaks by exactly one");
    }
    if (target is not null && rerun.OverriddenBreaks.Count != 1)
    {
        failures.Add("seeded manual override did not produce exactly one overridden break");
    }

    var idempotent =
        rerun.Breaks.Select(candidate => (candidate.BreakKey, candidate.Status))
            .SequenceEqual(
                repeated.Breaks.Select(candidate => (candidate.BreakKey, candidate.Status)));
    if (!idempotent)
    {
        failures.Add("override rerun changed break keys or statuses");
    }

    var evidence = new
    {
        schemaVersion = "override-suppression-evidence/1.0.0",
        passed = failures.Count == 0,
        businessDate = options.BusinessDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        initialOpenBreakCount = initial.OpenBreaks.Count,
        rerunOpenBreakCount = rerun.OpenBreaks.Count,
        overriddenBreakCount = rerun.OverriddenBreaks.Count,
        suppressedBreakKey = target?.BreakKey,
        suppressedBreakStatus = suppressed?.Status.ToString(),
        idempotent,
        failures
    };
    Console.Write(JsonSerializer.Serialize(evidence));
    return failures.Count == 0 ? 0 : 2;
}
catch (Exception error)
{
    Console.Error.WriteLine($"{error.GetType().Name}: {error.Message}");
    return 1;
}

static HarnessOptions? ParseArguments(string[] arguments)
{
    string? date = null;
    string? fixtures = null;
    for (var index = 0; index < arguments.Length; index++)
    {
        switch (arguments[index])
        {
            case "--date" when index + 1 < arguments.Length:
                date = arguments[++index];
                break;
            case "--fixtures" when index + 1 < arguments.Length:
                fixtures = arguments[++index];
                break;
            default:
                Console.Error.WriteLine($"Unknown or incomplete argument: {arguments[index]}");
                return null;
        }
    }

    if (
        !DateOnly.TryParseExact(
            date,
            "yyyy-MM-dd",
            CultureInfo.InvariantCulture,
            DateTimeStyles.None,
            out var businessDate) ||
        string.IsNullOrWhiteSpace(fixtures) ||
        !Directory.Exists(fixtures))
    {
        Console.Error.WriteLine("Usage: --date yyyy-MM-dd --fixtures <existing-directory>");
        return null;
    }

    return new HarnessOptions(businessDate, Path.GetFullPath(fixtures));
}

internal sealed record HarnessOptions(
    DateOnly BusinessDate,
    string FixturesDirectory);
