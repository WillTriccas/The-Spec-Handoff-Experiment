using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using LegacyTradeReconciliation.Domain;

namespace LegacyTradeReconciliation
{
    public sealed class ReconciliationBatch
    {
        private readonly CsvFileGateway _fileGateway;
        private readonly MatchingEngine _matchingEngine;
        private readonly EndOfDayReporter _reporter;

        public ReconciliationBatch()
            : this(new CsvFileGateway(), new MatchingEngine(), new EndOfDayReporter())
        {
        }

        public ReconciliationBatch(CsvFileGateway fileGateway, MatchingEngine matchingEngine, EndOfDayReporter reporter)
        {
            _fileGateway = fileGateway;
            _matchingEngine = matchingEngine;
            _reporter = reporter;
        }

        public int Run(string[] args)
        {
            RunRequest request = RunRequest.Resolve(args);
            Directory.CreateDirectory(request.OutputDirectory);

            string inputSignature = CalculateInputSignature(request);
            var ledgerStore = new RunLedgerStore(Path.Combine(request.OutputDirectory, BatchConfiguration.RunLedgerFileName));

            if (ledgerStore.Exists(request.BusinessDate, inputSignature) && OutputsExist(request.OutputDirectory))
            {
                Console.WriteLine("Exact rerun detected for " + request.BusinessDate.ToString("yyyy-MM-dd") + ". Existing outputs were retained.");
                return 0;
            }

            var result = _matchingEngine.Reconcile(
                _fileGateway.LoadTrades(request.InputDirectory),
                _fileGateway.LoadPositions(request.InputDirectory),
                _fileGateway.LoadSettlements(request.InputDirectory),
                _fileGateway.LoadOverrides(request.InputDirectory));

            _fileGateway.WriteMatchedTrades(request.OutputDirectory, result.MatchedTrades);
            _fileGateway.WriteBreakQueue(request.OutputDirectory, result.OpenBreaks);
            _fileGateway.WriteEndOfDayReport(request.OutputDirectory, _reporter.BuildReport(request.BusinessDate, result));

            ledgerStore.AppendIfMissing(new RunLedgerEntry
            {
                BusinessDate = request.BusinessDate,
                InputSignature = inputSignature,
                TotalTradesRead = result.TotalTradesRead,
                OpenBreakCount = result.OpenBreaks.Count,
                MatchedCount = result.MatchedTrades.Count
            });

            Console.WriteLine("Processed {0} trades into {1} matched rows and {2} open breaks.", result.TotalTradesRead, result.MatchedTrades.Count, result.OpenBreaks.Count);
            return 0;
        }

        private static string CalculateInputSignature(RunRequest request)
        {
            using (var sha256 = SHA256.Create())
            {
                var payload = new StringBuilder();
                payload.AppendLine(request.BusinessDate.ToString("yyyy-MM-dd"));

                foreach (string filePath in Directory.GetFiles(request.InputDirectory).OrderBy(path => path, StringComparer.OrdinalIgnoreCase))
                {
                    payload.AppendLine(Path.GetFileName(filePath));
                    payload.AppendLine(File.ReadAllText(filePath));
                }

                byte[] hash = sha256.ComputeHash(Encoding.UTF8.GetBytes(payload.ToString()));
                return string.Concat(hash.Select(value => value.ToString("x2")));
            }
        }

        private static bool OutputsExist(string outputDirectory)
        {
            return File.Exists(Path.Combine(outputDirectory, BatchConfiguration.MatchedTradesFileName)) &&
                   File.Exists(Path.Combine(outputDirectory, BatchConfiguration.BreakQueueFileName)) &&
                   File.Exists(Path.Combine(outputDirectory, BatchConfiguration.EndOfDayReportFileName));
        }
    }
}
