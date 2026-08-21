using TradeRecon.Domain;

namespace TradeRecon.Application.Abstractions;

/// <summary>
/// Persists reconciliation results keyed by business date. Writes are upserts so that a
/// rerun for the same date replaces the prior result, preserving idempotency.
/// </summary>
public interface IReconciliationResultRepository
{
    Task SaveAsync(ReconciliationResult result, CancellationToken cancellationToken = default);

    Task<ReconciliationResult?> GetAsync(DateOnly businessDate, CancellationToken cancellationToken = default);
}
