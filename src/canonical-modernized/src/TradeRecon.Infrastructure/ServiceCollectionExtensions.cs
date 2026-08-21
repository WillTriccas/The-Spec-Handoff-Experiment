using Microsoft.Extensions.DependencyInjection;
using TradeRecon.Application.Abstractions;
using TradeRecon.Application.Reconciliation;
using TradeRecon.Application.Reporting;
using TradeRecon.Infrastructure.Persistence;
using TradeRecon.Infrastructure.Reporting;
using TradeRecon.Infrastructure.Sources;

namespace TradeRecon.Infrastructure;

/// <summary>
/// Composition helpers wiring the reconciliation engine and its infrastructure adapters
/// into a dependency-injection container.
/// </summary>
public static class ServiceCollectionExtensions
{
    /// <summary>Registers the reconciliation engine, runner and report builder.</summary>
    public static IServiceCollection AddTradeReconCore(this IServiceCollection services)
    {
        services.AddSingleton<IReconciliationEngine, ReconciliationEngine>();
        services.AddSingleton<EndOfDayReportBuilder>();
        services.AddSingleton<ReconciliationRunner>();
        return services;
    }

    /// <summary>Registers CSV-backed sources and in-memory stores for the baseline host.</summary>
    public static IServiceCollection AddTradeReconInfrastructure(
        this IServiceCollection services,
        string fixturesDirectory,
        string reportOutputDirectory)
    {
        services.AddSingleton(new CsvBatchSourceOptions { FixturesDirectory = fixturesDirectory });
        services.AddSingleton(new FileReportWriterOptions { OutputDirectory = reportOutputDirectory });

        services.AddSingleton<IReconciliationBatchSource, CsvReconciliationBatchSource>();
        services.AddSingleton<IReconciliationResultRepository, InMemoryReconciliationResultRepository>();
        services.AddSingleton<IManualOverrideStore, InMemoryManualOverrideStore>();
        services.AddSingleton<IReportWriter, FileReportWriter>();
        return services;
    }
}
