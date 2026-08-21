using TradeRecon.Domain;

namespace TradeRecon.Application.Abstractions;

/// <summary>Loads the reconciliation inputs for a business date from a backing store.</summary>
public interface IReconciliationBatchSource
{
    Task<ReconciliationBatch> LoadAsync(DateOnly businessDate, CancellationToken cancellationToken = default);
}
