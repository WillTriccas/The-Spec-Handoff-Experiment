using Microsoft.Extensions.Logging;
using TradeRecon.Application.Abstractions;
using TradeRecon.Application.Reporting;
using TradeRecon.Domain;

namespace TradeRecon.Application.Reconciliation;

/// <summary>
/// Orchestrates a full reconciliation run for a business date: load inputs, apply stored
/// manual overrides, reconcile, persist the result (upsert for idempotency) and emit the
/// end-of-day reports. Running the same date twice with identical inputs and overrides
/// yields an equivalent persisted result and identical reports.
/// </summary>
public sealed class ReconciliationRunner
{
    private readonly IReconciliationBatchSource _source;
    private readonly IReconciliationEngine _engine;
    private readonly IReconciliationResultRepository _repository;
    private readonly IManualOverrideStore _overrides;
    private readonly IReportWriter _reportWriter;
    private readonly EndOfDayReportBuilder _reportBuilder;
    private readonly ILogger<ReconciliationRunner> _logger;

    public ReconciliationRunner(
        IReconciliationBatchSource source,
        IReconciliationEngine engine,
        IReconciliationResultRepository repository,
        IManualOverrideStore overrides,
        IReportWriter reportWriter,
        EndOfDayReportBuilder reportBuilder,
        ILogger<ReconciliationRunner> logger)
    {
        _source = source ?? throw new ArgumentNullException(nameof(source));
        _engine = engine ?? throw new ArgumentNullException(nameof(engine));
        _repository = repository ?? throw new ArgumentNullException(nameof(repository));
        _overrides = overrides ?? throw new ArgumentNullException(nameof(overrides));
        _reportWriter = reportWriter ?? throw new ArgumentNullException(nameof(reportWriter));
        _reportBuilder = reportBuilder ?? throw new ArgumentNullException(nameof(reportBuilder));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<ReconciliationResult> RunAsync(
        DateOnly businessDate,
        ReconciliationRunOptions options,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);

        _logger.LogInformation("Starting reconciliation run for {BusinessDate}.", businessDate);

        var batch = await _source.LoadAsync(businessDate, cancellationToken).ConfigureAwait(false);
        var overriddenKeys = await _overrides
            .GetOverriddenBreakKeysAsync(businessDate, cancellationToken)
            .ConfigureAwait(false);

        var result = _engine.Reconcile(batch, options, overriddenKeys);

        await _repository.SaveAsync(result, cancellationToken).ConfigureAwait(false);

        var summary = _reportBuilder.BuildSummary(result);
        var register = _reportBuilder.BuildBreakRegister(result);
        var json = _reportBuilder.BuildJson(result);

        var summaryLocation = await _reportWriter
            .WriteAsync(businessDate, EndOfDayReportBuilder.SummaryReportName, summary, cancellationToken)
            .ConfigureAwait(false);
        var registerLocation = await _reportWriter
            .WriteAsync(businessDate, EndOfDayReportBuilder.BreakRegisterReportName, register, cancellationToken)
            .ConfigureAwait(false);
        var jsonLocation = await _reportWriter
            .WriteAsync(businessDate, EndOfDayReportBuilder.JsonResultReportName, json, cancellationToken)
            .ConfigureAwait(false);

        _logger.LogInformation(
            "Completed reconciliation run for {BusinessDate}. Reports: {Summary}, {Register}, {Json}.",
            businessDate,
            summaryLocation,
            registerLocation,
            jsonLocation);

        return result;
    }
}
