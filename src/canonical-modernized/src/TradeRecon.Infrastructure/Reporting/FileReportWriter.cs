using Microsoft.Extensions.Logging;
using TradeRecon.Application.Abstractions;

namespace TradeRecon.Infrastructure.Reporting;

/// <summary>Configuration for <see cref="FileReportWriter"/>.</summary>
public sealed record FileReportWriterOptions
{
    /// <summary>Root directory under which per-date report folders are created.</summary>
    public required string OutputDirectory { get; init; }
}

/// <summary>
/// Writes reports to <c>{OutputDirectory}/{yyyy-MM-dd}/{reportName}.txt</c>. Report names
/// carry no extension; a <c>.txt</c> suffix is applied. Writes overwrite any prior file so
/// reruns produce a single, current artefact per report.
/// </summary>
public sealed class FileReportWriter : IReportWriter
{
    private readonly FileReportWriterOptions _options;
    private readonly ILogger<FileReportWriter> _logger;

    public FileReportWriter(FileReportWriterOptions options, ILogger<FileReportWriter> logger)
    {
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<string> WriteAsync(
        DateOnly businessDate,
        string reportName,
        string content,
        CancellationToken cancellationToken = default)
    {
        var directory = Path.Combine(_options.OutputDirectory, businessDate.ToString("yyyy-MM-dd"));
        Directory.CreateDirectory(directory);

        var extension = reportName switch
        {
            _ when reportName.Contains("register", StringComparison.OrdinalIgnoreCase) => ".csv",
            _ when reportName.Contains("result", StringComparison.OrdinalIgnoreCase) => ".json",
            _ => ".txt"
        };
        var path = Path.Combine(directory, reportName + extension);

        await File.WriteAllTextAsync(path, content, cancellationToken).ConfigureAwait(false);
        _logger.LogInformation("Wrote report {ReportName} to {Path}.", reportName, path);
        return path;
    }
}
