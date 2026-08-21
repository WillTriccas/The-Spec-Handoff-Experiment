using System.Globalization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Console;
using TradeRecon.Application.Reconciliation;
using TradeRecon.Application.Reporting;
using TradeRecon.Domain;
using TradeRecon.Infrastructure;

namespace TradeRecon.Console;

/// <summary>
/// Console host for the canonical trade-reconciliation baseline. Runs a deterministic
/// end-of-day reconciliation over the synthetic CSV fixtures and writes the reports.
///
/// This host exposes a stable, black-box-friendly CLI contract:
///   * Inputs come from a fixture directory (--fixtures) containing trades.csv,
///     settlements.csv and positions.csv.
///   * Reports are written under --out/&lt;yyyy-MM-dd&gt;/ as eod-summary.txt,
///     eod-break-register.csv and eod-result.json.
///   * With --json the deterministic JSON result is written to stdout (and all logs are
///     routed to stderr) so stdout contains nothing but the JSON document.
///   * Exit codes: 0 = clean, 2 = breaks outstanding, 1 = input/processing error.
///
/// Usage: TradeRecon.Console [--date yyyy-MM-dd] [--fixtures &lt;dir&gt;] [--out &lt;dir&gt;] [--json]
/// </summary>
public static class Program
{
    /// <summary>Reconciliation completed with no open breaks.</summary>
    public const int ExitClean = 0;

    /// <summary>Input or processing error (e.g. missing or malformed fixtures).</summary>
    public const int ExitError = 1;

    /// <summary>Reconciliation completed but open breaks remain.</summary>
    public const int ExitBreaks = 2;

    public static async Task<int> Main(string[] args)
    {
        if (args.Contains("--help") || args.Contains("-h"))
        {
            System.Console.WriteLine(
                "Usage: TradeRecon.Console [--date yyyy-MM-dd] [--fixtures <dir>] [--out <dir>] [--json]");
            return ExitClean;
        }

        CliOptions options;
        try
        {
            options = CliOptions.Parse(args);
        }
        catch (Exception ex) when (ex is FormatException or ArgumentException or PathTooLongException or NotSupportedException)
        {
            System.Console.Error.WriteLine($"Invalid arguments: {ex.Message}");
            return ExitError;
        }

        using var loggerFactory = LoggerFactory.Create(builder =>
        {
            builder.SetMinimumLevel(LogLevel.Information);
            builder.AddSimpleConsole(o =>
            {
                o.SingleLine = true;
                o.TimestampFormat = "HH:mm:ss ";
            });
            // In JSON mode keep stdout pure by sending every log line to stderr.
            if (options.JsonOutput)
            {
                builder.Services.Configure<ConsoleLoggerOptions>(
                    o => o.LogToStandardErrorThreshold = LogLevel.Trace);
            }
        });

        var services = new ServiceCollection();
        services.AddSingleton<ILoggerFactory>(loggerFactory);
        services.AddLogging();
        services.AddTradeReconCore();
        services.AddTradeReconInfrastructure(options.FixturesDirectory, options.OutputDirectory);

        await using var provider = services.BuildServiceProvider();
        var logger = provider.GetRequiredService<ILogger<object>>();
        var runner = provider.GetRequiredService<ReconciliationRunner>();
        var reportBuilder = provider.GetRequiredService<EndOfDayReportBuilder>();

        var runOptions = new ReconciliationRunOptions
        {
            Tolerances = new ToleranceOptions
            {
                QuantityAbsolute = 0m,
                AmountAbsolute = 0.01m,
                SettlementDateDays = 0,
                PositionQuantityAbsolute = 0m
            }
        };

        try
        {
            var result = await runner.RunAsync(options.BusinessDate, runOptions).ConfigureAwait(false);

            if (options.JsonOutput)
            {
                System.Console.Out.Write(reportBuilder.BuildJson(result));
                System.Console.Out.Write('\n');
            }
            else
            {
                System.Console.WriteLine();
                System.Console.WriteLine($"Business date : {result.BusinessDate:yyyy-MM-dd}");
                System.Console.WriteLine($"Matched pairs : {result.Matches.Count}");
                System.Console.WriteLine($"Open breaks   : {result.OpenBreaks.Count}");
                System.Console.WriteLine($"Overridden    : {result.OverriddenBreaks.Count}");
                System.Console.WriteLine($"Status        : {EndOfDayReportBuilder.StatusText(result)}");
                System.Console.WriteLine($"Reports       : {options.OutputDirectory}");
            }

            return result.IsClean ? ExitClean : ExitBreaks;
        }
        catch (Exception ex) when (ex is FileNotFoundException or DirectoryNotFoundException or FormatException)
        {
            logger.LogError(ex, "Reconciliation failed: {Message}", ex.Message);
            return ExitError;
        }
    }

    private sealed record CliOptions(
        DateOnly BusinessDate,
        string FixturesDirectory,
        string OutputDirectory,
        bool JsonOutput)
    {
        public static CliOptions Parse(string[] args)
        {
            var date = new DateOnly(2024, 6, 3);
            var baseDir = AppContext.BaseDirectory;
            var fixtures = Path.GetFullPath(Path.Combine(baseDir, "fixtures"));
            var output = Path.GetFullPath(Path.Combine(baseDir, "reports"));
            var json = false;

            for (var i = 0; i < args.Length; i++)
            {
                switch (args[i])
                {
                    case "--date":
                        date = DateOnly.ParseExact(NextValue(args, ref i, "--date"), "yyyy-MM-dd", CultureInfo.InvariantCulture);
                        break;
                    case "--fixtures":
                        fixtures = Path.GetFullPath(NextValue(args, ref i, "--fixtures"));
                        break;
                    case "--out":
                        output = Path.GetFullPath(NextValue(args, ref i, "--out"));
                        break;
                    case "--json":
                        json = true;
                        break;
                    default:
                        throw new ArgumentException($"Unknown argument '{args[i]}'.");
                }
            }

            return new CliOptions(date, fixtures, output, json);
        }

        private static string NextValue(string[] args, ref int index, string option)
        {
            if (index + 1 >= args.Length || args[index + 1].StartsWith("--", StringComparison.Ordinal))
            {
                throw new ArgumentException($"Option {option} requires a value.");
            }

            return args[++index];
        }
    }
}
