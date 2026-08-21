using System.Collections.Concurrent;
using TradeRecon.Application.Abstractions;
using TradeRecon.Domain;

namespace TradeRecon.Infrastructure.Persistence;

/// <summary>
/// In-memory manual override store keyed by business date and break key. Adding the same
/// override twice is a no-op, keeping override application deterministic across reruns.
/// This store deliberately implements no approval workflow or history.
/// </summary>
public sealed class InMemoryManualOverrideStore : IManualOverrideStore
{
    private readonly ConcurrentDictionary<DateOnly, ConcurrentDictionary<string, ManualOverride>> _byDate = new();

    public Task<IReadOnlySet<string>> GetOverriddenBreakKeysAsync(
        DateOnly businessDate,
        CancellationToken cancellationToken = default)
    {
        IReadOnlySet<string> keys = _byDate.TryGetValue(businessDate, out var map)
            ? map.Keys.ToHashSet(StringComparer.Ordinal)
            : new HashSet<string>(StringComparer.Ordinal);
        return Task.FromResult(keys);
    }

    public Task AddAsync(ManualOverride manualOverride, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(manualOverride);
        var map = _byDate.GetOrAdd(
            manualOverride.BusinessDate,
            _ => new ConcurrentDictionary<string, ManualOverride>(StringComparer.Ordinal));
        map[manualOverride.BreakKey] = manualOverride;
        return Task.CompletedTask;
    }
}
