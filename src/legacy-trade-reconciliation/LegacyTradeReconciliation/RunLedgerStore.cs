using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using LegacyTradeReconciliation.Domain;

namespace LegacyTradeReconciliation
{
    public sealed class RunLedgerStore
    {
        private readonly string _ledgerPath;

        public RunLedgerStore(string ledgerPath)
        {
            _ledgerPath = ledgerPath;
        }

        public bool Exists(DateTime businessDate, string signature)
        {
            return LoadEntries().Any(entry =>
                entry.BusinessDate == businessDate &&
                string.Equals(entry.InputSignature, signature, StringComparison.Ordinal));
        }

        public void AppendIfMissing(RunLedgerEntry entry)
        {
            if (Exists(entry.BusinessDate, entry.InputSignature))
            {
                return;
            }

            bool fileExists = File.Exists(_ledgerPath);
            using (var writer = new StreamWriter(_ledgerPath, true))
            {
                if (!fileExists)
                {
                    writer.WriteLine("business_date,input_signature,total_trades_read,open_break_count,matched_count");
                }

                writer.WriteLine(string.Join(",",
                    entry.BusinessDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    entry.InputSignature,
                    entry.TotalTradesRead.ToString(CultureInfo.InvariantCulture),
                    entry.OpenBreakCount.ToString(CultureInfo.InvariantCulture),
                    entry.MatchedCount.ToString(CultureInfo.InvariantCulture)));
            }
        }

        private List<RunLedgerEntry> LoadEntries()
        {
            if (!File.Exists(_ledgerPath))
            {
                return new List<RunLedgerEntry>();
            }

            return File.ReadAllLines(_ledgerPath)
                .Skip(1)
                .Where(line => !string.IsNullOrWhiteSpace(line))
                .Select(ParseEntry)
                .ToList();
        }

        private static RunLedgerEntry ParseEntry(string line)
        {
            string[] cells = line.Split(',');
            return new RunLedgerEntry
            {
                BusinessDate = DateTime.ParseExact(cells[0], "yyyy-MM-dd", CultureInfo.InvariantCulture),
                InputSignature = cells[1],
                TotalTradesRead = int.Parse(cells[2], CultureInfo.InvariantCulture),
                OpenBreakCount = int.Parse(cells[3], CultureInfo.InvariantCulture),
                MatchedCount = int.Parse(cells[4], CultureInfo.InvariantCulture)
            };
        }
    }
}
