using System;
using System.Globalization;
using System.Linq;
using System.Text;
using LegacyTradeReconciliation.Domain;

namespace LegacyTradeReconciliation
{
    public sealed class EndOfDayReporter
    {
        public string BuildReport(DateTime businessDate, ReconciliationResult result)
        {
            var report = new StringBuilder();
            report.AppendLine("Legacy Trade Reconciliation - End Of Day Report");
            report.AppendLine("Business Date: " + businessDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
            report.AppendLine();
            report.AppendLine("Totals");
            report.AppendLine("------");
            report.AppendLine("Trades Read: " + result.TotalTradesRead);
            report.AppendLine("Canonical Trades: " + result.CanonicalTradeCount);
            report.AppendLine("Matched: " + result.MatchedCount);
            report.AppendLine("Manual Override Matched: " + result.ManualOverrideMatchedCount);
            report.AppendLine("Manual Override Suppressed: " + result.ManualOverrideSuppressedCount);
            report.AppendLine("Open Breaks: " + result.OpenBreaks.Count);
            report.AppendLine("Duplicate Trades: " + result.DuplicateTradeCount);
            report.AppendLine("Stale Overrides: " + result.StaleOverrides.Count);
            report.AppendLine();
            report.AppendLine("Open Break Reasons");
            report.AppendLine("------------------");

            var reasonCounts = result.OpenBreaks
                .SelectMany(record => record.Reasons.Split('|'))
                .Select(reason => reason.Trim())
                .Where(reason => !string.IsNullOrWhiteSpace(reason))
                .GroupBy(reason => reason, StringComparer.Ordinal)
                .OrderBy(group => group.Key, StringComparer.Ordinal);

            foreach (var reasonCount in reasonCounts)
            {
                report.AppendLine(reasonCount.Key + ": " + reasonCount.Count());
            }

            if (!reasonCounts.Any())
            {
                report.AppendLine("None");
            }

            if (result.StaleOverrides.Any())
            {
                report.AppendLine();
                report.AppendLine("Stale Overrides");
                report.AppendLine("---------------");

                foreach (var staleOverride in result.StaleOverrides.OrderBy(item => item.TradeId, StringComparer.Ordinal))
                {
                    report.AppendLine(staleOverride.TradeId + ": " + staleOverride.Action + " (" + staleOverride.ApprovedBy + ")");
                }
            }

            return report.ToString().TrimEnd() + Environment.NewLine;
        }
    }
}
