using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using LegacyTradeReconciliation.Domain;

namespace LegacyTradeReconciliation
{
    public sealed class CsvFileGateway
    {
        public List<TradeRecord> LoadTrades(string inputDirectory)
        {
            return ReadRequiredLines(inputDirectory, BatchConfiguration.TradesFileName)
                .Skip(1)
                .Where(line => !string.IsNullOrWhiteSpace(line))
                .Select(ParseTrade)
                .ToList();
        }

        public List<PositionRecord> LoadPositions(string inputDirectory)
        {
            return ReadRequiredLines(inputDirectory, BatchConfiguration.PositionsFileName)
                .Skip(1)
                .Where(line => !string.IsNullOrWhiteSpace(line))
                .Select(ParsePosition)
                .ToList();
        }

        public List<SettlementRecord> LoadSettlements(string inputDirectory)
        {
            return ReadRequiredLines(inputDirectory, BatchConfiguration.SettlementsFileName)
                .Skip(1)
                .Where(line => !string.IsNullOrWhiteSpace(line))
                .Select(ParseSettlement)
                .ToList();
        }

        public List<ManualOverrideRecord> LoadOverrides(string inputDirectory)
        {
            string path = Path.Combine(inputDirectory, BatchConfiguration.OverridesFileName);
            if (!File.Exists(path))
            {
                return new List<ManualOverrideRecord>();
            }

            return File.ReadAllLines(path)
                .Skip(1)
                .Where(line => !string.IsNullOrWhiteSpace(line))
                .Select(ParseOverride)
                .ToList();
        }

        public void WriteMatchedTrades(string outputDirectory, IReadOnlyCollection<MatchedTradeRecord> matchedTrades)
        {
            string path = Path.Combine(outputDirectory, BatchConfiguration.MatchedTradesFileName);
            var lines = new List<string>
            {
                "trade_id,status,account,instrument,quantity,settlement_date,currency,position_id,settlement_id,override_note"
            };

            lines.AddRange(matchedTrades
                .OrderBy(record => record.TradeId, StringComparer.Ordinal)
                .Select(record => string.Join(",",
                    record.TradeId,
                    record.Status,
                    record.Account,
                    record.Instrument,
                    FormatDecimal(record.Quantity),
                    record.SettlementDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    record.Currency,
                    record.PositionId ?? string.Empty,
                    record.SettlementId ?? string.Empty,
                    record.OverrideNote ?? string.Empty)));

            File.WriteAllLines(path, lines);
        }

        public void WriteBreakQueue(string outputDirectory, IReadOnlyCollection<BreakRecord> breakQueue)
        {
            string path = Path.Combine(outputDirectory, BatchConfiguration.BreakQueueFileName);
            var lines = new List<string>
            {
                "trade_id,account,instrument,quantity,settlement_date,currency,reasons,position_id,settlement_id"
            };

            lines.AddRange(breakQueue
                .OrderBy(record => record.TradeId, StringComparer.Ordinal)
                .ThenBy(record => record.Reasons, StringComparer.Ordinal)
                .Select(record => string.Join(",",
                    record.TradeId,
                    record.Account,
                    record.Instrument,
                    FormatDecimal(record.Quantity),
                    record.SettlementDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    record.Currency,
                    record.Reasons,
                    record.PositionId ?? string.Empty,
                    record.SettlementId ?? string.Empty)));

            File.WriteAllLines(path, lines);
        }

        public void WriteEndOfDayReport(string outputDirectory, string reportText)
        {
            File.WriteAllText(Path.Combine(outputDirectory, BatchConfiguration.EndOfDayReportFileName), reportText);
        }

        private static string[] ReadRequiredLines(string inputDirectory, string fileName)
        {
            return File.ReadAllLines(Path.Combine(inputDirectory, fileName));
        }

        private static TradeRecord ParseTrade(string line)
        {
            string[] cells = Split(line, 7);
            return new TradeRecord
            {
                TradeId = cells[0],
                Account = cells[1],
                Instrument = cells[2],
                Quantity = ParseDecimal(cells[3]),
                SettlementDate = ParseDate(cells[4]),
                Currency = cells[5],
                NetAmount = ParseDecimal(cells[6])
            };
        }

        private static PositionRecord ParsePosition(string line)
        {
            string[] cells = Split(line, 6);
            return new PositionRecord
            {
                PositionId = cells[0],
                Account = cells[1],
                Instrument = cells[2],
                Quantity = ParseDecimal(cells[3]),
                SettlementDate = ParseDate(cells[4]),
                Currency = cells[5]
            };
        }

        private static SettlementRecord ParseSettlement(string line)
        {
            string[] cells = Split(line, 7);
            return new SettlementRecord
            {
                SettlementId = cells[0],
                Account = cells[1],
                Instrument = cells[2],
                Quantity = ParseDecimal(cells[3]),
                SettlementDate = ParseDate(cells[4]),
                Currency = cells[5],
                CashAmount = ParseDecimal(cells[6])
            };
        }

        private static ManualOverrideRecord ParseOverride(string line)
        {
            string[] cells = Split(line, 4);
            return new ManualOverrideRecord
            {
                TradeId = cells[0],
                Action = cells[1],
                Note = cells[2],
                ApprovedBy = cells[3]
            };
        }

        private static string[] Split(string line, int expectedCellCount)
        {
            string[] cells = line.Split(',');
            if (cells.Length != expectedCellCount)
            {
                throw new InvalidDataException("Unexpected csv format: " + line);
            }

            return cells.Select(value => value.Trim()).ToArray();
        }

        private static decimal ParseDecimal(string value)
        {
            return decimal.Parse(value, NumberStyles.Number | NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture);
        }

        private static DateTime ParseDate(string value)
        {
            return DateTime.ParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        private static string FormatDecimal(decimal value)
        {
            return value.ToString("0.####", CultureInfo.InvariantCulture);
        }
    }
}
