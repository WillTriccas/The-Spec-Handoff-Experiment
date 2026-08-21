using TradeRecon.Domain;

namespace TradeRecon.Application.Abstractions;

/// <summary>Writes a rendered end-of-day report to a destination and returns its location.</summary>
public interface IReportWriter
{
    /// <summary>
    /// Persists the report content for a business date. Returns an opaque location
    /// descriptor (e.g. a file path) for logging and downstream consumption.
    /// </summary>
    Task<string> WriteAsync(
        DateOnly businessDate,
        string reportName,
        string content,
        CancellationToken cancellationToken = default);
}
