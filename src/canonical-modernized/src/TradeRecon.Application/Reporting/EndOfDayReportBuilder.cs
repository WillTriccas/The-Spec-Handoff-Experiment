using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using TradeRecon.Domain;

namespace TradeRecon.Application.Reporting;

/// <summary>
/// Renders end-of-day reconciliation reports. Three artefacts are produced: a human-readable
/// summary (text), a machine-readable break register (CSV) and a deterministic JSON result
/// intended for black-box evaluation. Rendering is deterministic and contains no sensitive
/// personal data.
/// </summary>
public sealed class EndOfDayReportBuilder
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    /// <summary>Version stamped into the JSON result so evaluators can pin expectations.</summary>
    public const string JsonSchemaVersion = "1.0";

    public const string SummaryReportName = "eod-summary";
    public const string BreakRegisterReportName = "eod-break-register";
    public const string JsonResultReportName = "eod-result";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter() }
    };

    public string BuildSummary(ReconciliationResult result)
    {
        ArgumentNullException.ThrowIfNull(result);

        var sb = new StringBuilder();
        sb.Append("End-of-Day Reconciliation Summary\n");
        sb.Append("=================================\n");
        sb.Append($"Business date      : {result.BusinessDate:yyyy-MM-dd}\n");
        sb.Append($"Trades ingested    : {result.TradeCount.ToString(Inv)}\n");
        sb.Append($"Settlements ingested: {result.SettlementCount.ToString(Inv)}\n");
        sb.Append($"Positions ingested : {result.PositionCount.ToString(Inv)}\n");
        sb.Append($"Matched pairs      : {result.Matches.Count.ToString(Inv)}\n");
        sb.Append($"Open breaks        : {result.OpenBreaks.Count.ToString(Inv)}\n");
        sb.Append($"Overridden breaks  : {result.OverriddenBreaks.Count.ToString(Inv)}\n");
        sb.Append($"Status             : {(result.IsClean ? "CLEAN" : "BREAKS OUTSTANDING")}\n");
        sb.Append('\n');

        sb.Append("Open breaks by type\n");
        sb.Append("-------------------\n");
        var byType = result.OpenBreaks
            .GroupBy(b => b.Type)
            .OrderBy(g => g.Key)
            .ToList();
        if (byType.Count == 0)
        {
            sb.Append("(none)\n");
        }
        else
        {
            foreach (var group in byType)
            {
                sb.Append($"{group.Key,-24}: {group.Count().ToString(Inv)}\n");
            }
        }

        return sb.ToString();
    }

    public string BuildBreakRegister(ReconciliationResult result)
    {
        ArgumentNullException.ThrowIfNull(result);

        var sb = new StringBuilder();
        sb.Append("BusinessDate,BreakKey,Type,Status,Account,Instrument,Currency,TradeId,SettlementId,Difference,Detail\n");

        foreach (var b in result.Breaks)
        {
            sb.Append(string.Join(',',
                b.BusinessDate.ToString("yyyy-MM-dd"),
                Csv(b.BreakKey),
                b.Type,
                b.Status,
                Csv(b.Key.Account),
                Csv(b.Key.Instrument),
                Csv(b.Key.Currency),
                Csv(b.TradeId ?? string.Empty),
                Csv(b.SettlementId ?? string.Empty),
                b.Difference?.ToString(Inv) ?? string.Empty,
                Csv(b.Detail)));
            sb.Append('\n');
        }

        return sb.ToString();
    }

    /// <summary>The canonical status string used across all report artefacts.</summary>
    public static string StatusText(ReconciliationResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        return result.IsClean ? "Clean" : "BreaksOutstanding";
    }

    /// <summary>Renders the deterministic JSON result for black-box evaluation.</summary>
    public string BuildJson(ReconciliationResult result)
    {
        ArgumentNullException.ThrowIfNull(result);

        var openByType = result.OpenBreaks
            .GroupBy(b => b.Type)
            .OrderBy(g => g.Key)
            .ToDictionary(g => g.Key.ToString(), g => g.Count());

        var report = new JsonReconciliationReport
        {
            SchemaVersion = JsonSchemaVersion,
            BusinessDate = result.BusinessDate.ToString("yyyy-MM-dd"),
            Status = StatusText(result),
            TradeCount = result.TradeCount,
            SettlementCount = result.SettlementCount,
            PositionCount = result.PositionCount,
            MatchCount = result.Matches.Count,
            OpenBreakCount = result.OpenBreaks.Count,
            OverriddenBreakCount = result.OverriddenBreaks.Count,
            OpenBreakCountsByType = openByType,
            Breaks = result.Breaks.Select(b => new JsonBreak
            {
                BreakKey = b.BreakKey,
                Type = b.Type.ToString(),
                Status = b.Status.ToString(),
                Account = b.Key.Account,
                Instrument = b.Key.Instrument,
                Currency = b.Key.Currency,
                TradeId = b.TradeId,
                SettlementId = b.SettlementId,
                Difference = b.Difference,
                Detail = b.Detail
            }).ToList(),
            Matches = result.Matches.Select(m => new JsonMatch
            {
                Account = m.Key.Account,
                Instrument = m.Key.Instrument,
                Currency = m.Key.Currency,
                TradeId = m.Trade.TradeId,
                SettlementId = m.Settlement.SettlementId
            }).ToList()
        };

        return JsonSerializer.Serialize(report, JsonOptions);
    }

    private static string Csv(string value)
    {
        if (value.IndexOfAny(new[] { ',', '"', '\n', '\r' }) < 0)
        {
            return value;
        }

        return $"\"{value.Replace("\"", "\"\"")}\"";
    }
}
