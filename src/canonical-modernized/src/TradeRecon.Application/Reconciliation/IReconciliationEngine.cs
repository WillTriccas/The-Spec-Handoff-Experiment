using TradeRecon.Domain;

namespace TradeRecon.Application.Reconciliation;

/// <summary>
/// Reconciles a batch of trades, settlements and positions into a deterministic result.
/// The engine is pure with respect to its inputs and options: identical inputs always
/// yield an equivalent <see cref="ReconciliationResult"/>.
/// </summary>
public interface IReconciliationEngine
{
    ReconciliationResult Reconcile(
        ReconciliationBatch batch,
        ReconciliationRunOptions options,
        IReadOnlySet<string> overriddenBreakKeys);
}
