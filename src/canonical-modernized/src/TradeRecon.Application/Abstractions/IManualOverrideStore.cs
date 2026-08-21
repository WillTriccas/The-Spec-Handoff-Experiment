using TradeRecon.Domain;

namespace TradeRecon.Application.Abstractions;

/// <summary>
/// Stores the manual overrides that suppress specific breaks. The store is keyed by
/// <see cref="ManualOverride.BreakKey"/> so that applying overrides is deterministic and
/// stable across reruns. This is intentionally a plain override store with no approval
/// workflow or audit history.
/// </summary>
public interface IManualOverrideStore
{
    Task<IReadOnlySet<string>> GetOverriddenBreakKeysAsync(
        DateOnly businessDate,
        CancellationToken cancellationToken = default);

    Task AddAsync(ManualOverride manualOverride, CancellationToken cancellationToken = default);
}
