using System.Collections.Concurrent;
using TradeRecon.Application.Abstractions;
using TradeRecon.Domain;

namespace TradeRecon.Infrastructure.Persistence;

/// <summary>
/// In-memory result store keyed by business date. Saves are upserts, giving idempotent
/// reruns for the same date. Suitable for the console baseline and tests; a durable
/// implementation would swap in here without touching the application layer.
/// </summary>
public sealed class InMemoryReconciliationResultRepository : IReconciliationResultRepository
{
    private readonly ConcurrentDictionary<DateOnly, ReconciliationResult> _byDate = new();

    public Task SaveAsync(ReconciliationResult result, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(result);
        _byDate[result.BusinessDate] = result;
        return Task.CompletedTask;
    }

    public Task<ReconciliationResult?> GetAsync(DateOnly businessDate, CancellationToken cancellationToken = default)
    {
        _byDate.TryGetValue(businessDate, out var result);
        return Task.FromResult(result);
    }
}
