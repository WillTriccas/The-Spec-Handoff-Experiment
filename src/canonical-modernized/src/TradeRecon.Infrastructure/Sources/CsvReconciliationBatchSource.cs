using Microsoft.Extensions.Logging;
using TradeRecon.Application.Abstractions;
using TradeRecon.Domain;

namespace TradeRecon.Infrastructure.Sources;

/// <summary>Configuration for <see cref="CsvReconciliationBatchSource"/>.</summary>
public sealed record CsvBatchSourceOptions
{
    /// <summary>Directory containing trades.csv, settlements.csv and positions.csv.</summary>
    public required string FixturesDirectory { get; init; }
}

/// <summary>
/// Loads reconciliation inputs from CSV fixtures on disk. Records are filtered to the
/// requested business date so a single fixture set can hold multiple days. Reading the same
/// files yields identical, deterministically ordered batches.
/// </summary>
public sealed class CsvReconciliationBatchSource : IReconciliationBatchSource
{
    private readonly CsvBatchSourceOptions _options;
    private readonly ILogger<CsvReconciliationBatchSource> _logger;

    public CsvReconciliationBatchSource(
        CsvBatchSourceOptions options,
        ILogger<CsvReconciliationBatchSource> logger)
    {
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<ReconciliationBatch> LoadAsync(
        DateOnly businessDate,
        CancellationToken cancellationToken = default)
    {
        var trades = await LoadTradesAsync(businessDate, cancellationToken).ConfigureAwait(false);
        var settlements = await LoadSettlementsAsync(businessDate, cancellationToken).ConfigureAwait(false);
        var positions = await LoadPositionsAsync(businessDate, cancellationToken).ConfigureAwait(false);

        _logger.LogInformation(
            "Loaded fixtures for {BusinessDate}: {Trades} trades, {Settlements} settlements, {Positions} positions.",
            businessDate,
            trades.Count,
            settlements.Count,
            positions.Count);

        return new ReconciliationBatch
        {
            BusinessDate = businessDate,
            Trades = trades,
            Settlements = settlements,
            Positions = positions
        };
    }

    private async Task<IReadOnlyList<Trade>> LoadTradesAsync(DateOnly date, CancellationToken ct)
    {
        var rows = await ReadFileAsync(
            "trades.csv",
            ["BusinessDate", "TradeId", "Account", "Instrument", "Quantity", "Direction", "SettlementDate", "Currency", "Amount"],
            ct).ConfigureAwait(false);
        return rows
            .Where(r => CsvReader.Date(r, "BusinessDate") == date)
            .Select(r => new Trade
            {
                TradeId = CsvReader.Text(r, "TradeId"),
                Account = CsvReader.Text(r, "Account"),
                Instrument = CsvReader.Text(r, "Instrument"),
                Quantity = CsvReader.PositiveDecimal(r, "Quantity"),
                Direction = ParseDirection(CsvReader.Text(r, "Direction")),
                SettlementDate = CsvReader.Date(r, "SettlementDate"),
                Currency = CsvReader.Text(r, "Currency").ToUpperInvariant(),
                Amount = CsvReader.PositiveDecimal(r, "Amount")
            })
            .ToList();
    }

    private async Task<IReadOnlyList<Settlement>> LoadSettlementsAsync(DateOnly date, CancellationToken ct)
    {
        var rows = await ReadFileAsync(
            "settlements.csv",
            ["BusinessDate", "SettlementId", "TradeId", "Account", "Instrument", "Quantity", "Direction", "SettlementDate", "Currency", "Amount"],
            ct).ConfigureAwait(false);
        return rows
            .Where(r => CsvReader.Date(r, "BusinessDate") == date)
            .Select(r => new Settlement
            {
                SettlementId = CsvReader.Text(r, "SettlementId"),
                TradeId = NullIfEmpty(CsvReader.Text(r, "TradeId")),
                Account = CsvReader.Text(r, "Account"),
                Instrument = CsvReader.Text(r, "Instrument"),
                Quantity = CsvReader.PositiveDecimal(r, "Quantity"),
                Direction = ParseDirection(CsvReader.Text(r, "Direction")),
                SettlementDate = CsvReader.Date(r, "SettlementDate"),
                Currency = CsvReader.Text(r, "Currency").ToUpperInvariant(),
                Amount = CsvReader.PositiveDecimal(r, "Amount")
            })
            .ToList();
    }

    private async Task<IReadOnlyList<Position>> LoadPositionsAsync(DateOnly date, CancellationToken ct)
    {
        var rows = await ReadFileAsync(
            "positions.csv",
            ["BusinessDate", "Account", "Instrument", "Currency", "NetQuantity"],
            ct).ConfigureAwait(false);
        return rows
            .Where(r => CsvReader.Date(r, "BusinessDate") == date)
            .Select(r => new Position
            {
                Account = CsvReader.Text(r, "Account"),
                Instrument = CsvReader.Text(r, "Instrument"),
                Currency = CsvReader.Text(r, "Currency").ToUpperInvariant(),
                NetQuantity = CsvReader.Decimal(r, "NetQuantity")
            })
            .ToList();
    }

    private async Task<IReadOnlyList<IReadOnlyDictionary<string, string>>> ReadFileAsync(
        string fileName,
        IReadOnlyCollection<string> requiredColumns,
        CancellationToken ct)
    {
        var path = Path.Combine(_options.FixturesDirectory, fileName);
        if (!File.Exists(path))
        {
            throw new FileNotFoundException($"Fixture file not found: {path}", path);
        }

        var content = await File.ReadAllTextAsync(path, ct).ConfigureAwait(false);
        return CsvReader.Read(content, requiredColumns);
    }

    private static TradeDirection ParseDirection(string value) => value.Trim().ToUpperInvariant() switch
    {
        "BUY" or "B" => TradeDirection.Buy,
        "SELL" or "S" => TradeDirection.Sell,
        _ => throw new FormatException($"Unrecognised trade direction '{value}'.")
    };

    private static string? NullIfEmpty(string value) => string.IsNullOrWhiteSpace(value) ? null : value;
}
