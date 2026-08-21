using System;
using System.Collections.Generic;
using System.Linq;
using LegacyTradeReconciliation.Domain;

namespace LegacyTradeReconciliation
{
    public sealed class MatchingEngine
    {
        public ReconciliationResult Reconcile(
            IReadOnlyCollection<TradeRecord> trades,
            IReadOnlyCollection<PositionRecord> positions,
            IReadOnlyCollection<SettlementRecord> settlements,
            IReadOnlyCollection<ManualOverrideRecord> overrides)
        {
            var matchedTrades = new List<MatchedTradeRecord>();
            var breakQueue = new List<BreakRecord>();
            var staleOverrides = new List<ManualOverrideRecord>();
            var overrideGroups = overrides.GroupBy(record => Normalize(record.TradeId), StringComparer.Ordinal).ToList();
            var overrideMap = overrideGroups.ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
            staleOverrides.AddRange(overrideGroups.SelectMany(group => group.Skip(1)));

            var positionsByPair = positions
                .GroupBy(position => BuildPairKey(position.Account, position.Instrument), StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => group.OrderBy(position => position.PositionId, StringComparer.Ordinal).ToList(), StringComparer.Ordinal);

            var settlementsByPair = settlements
                .GroupBy(settlement => BuildPairKey(settlement.Account, settlement.Instrument), StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => group.OrderBy(settlement => settlement.SettlementId, StringComparer.Ordinal).ToList(), StringComparer.Ordinal);

            var usedPositions = new HashSet<string>(StringComparer.Ordinal);
            var usedSettlements = new HashSet<string>(StringComparer.Ordinal);
            var seenTradeIds = new HashSet<string>(StringComparer.Ordinal);
            int duplicateTradeCount = 0;

            foreach (var trade in trades)
            {
                string normalizedTradeId = Normalize(trade.TradeId);
                if (!seenTradeIds.Add(normalizedTradeId))
                {
                    duplicateTradeCount++;
                    breakQueue.Add(CreateBreak(trade, "DuplicateTradeId", null, null, false));
                    continue;
                }

                if (trade.Quantity <= 0m || trade.NetAmount <= 0m)
                {
                    breakQueue.Add(CreateBreak(trade, "TradeValueOutOfBounds", null, null, false));
                    continue;
                }

                string pairKey = BuildPairKey(trade.Account, trade.Instrument);
                PositionRecord position = null;
                SettlementRecord settlement = null;
                var reasons = new List<string>();

                List<PositionRecord> positionCandidates;
                if (!positionsByPair.TryGetValue(pairKey, out positionCandidates))
                {
                    reasons.Add("MissingPosition");
                }
                else
                {
                    position = FindPosition(trade, positionCandidates, usedPositions, reasons);
                }

                List<SettlementRecord> settlementCandidates;
                if (!settlementsByPair.TryGetValue(pairKey, out settlementCandidates))
                {
                    reasons.Add("MissingSettlement");
                }
                else
                {
                    settlement = FindSettlement(trade, settlementCandidates, usedSettlements, reasons);
                }

                if (reasons.Count == 0 && position != null && settlement != null)
                {
                    usedPositions.Add(position.PositionId);
                    usedSettlements.Add(settlement.SettlementId);
                    matchedTrades.Add(CreateMatchedTrade(trade, "Matched", position.PositionId, settlement.SettlementId, null));
                    continue;
                }

                breakQueue.Add(CreateBreak(
                    trade,
                    string.Join("|", reasons.Distinct(StringComparer.Ordinal).OrderBy(reason => reason, StringComparer.Ordinal)),
                    position != null ? position.PositionId : GetNearestPositionId(trade, positionCandidates),
                    settlement != null ? settlement.SettlementId : GetNearestSettlementId(trade, settlementCandidates),
                    positionCandidates != null && settlementCandidates != null && reasons.All(reason => reason != "MissingPosition" && reason != "MissingSettlement" && reason != "DuplicateTradeId" && reason != "TradeValueOutOfBounds")));
            }

            var resolvedTrades = new HashSet<string>(StringComparer.Ordinal);
            foreach (var breakRecord in breakQueue.ToList())
            {
                ManualOverrideRecord manualOverride;
                if (!overrideMap.TryGetValue(Normalize(breakRecord.TradeId), out manualOverride))
                {
                    continue;
                }

                resolvedTrades.Add(Normalize(breakRecord.TradeId));
                if (!breakRecord.CanManualOverride || string.IsNullOrWhiteSpace(manualOverride.Note) || string.IsNullOrWhiteSpace(manualOverride.ApprovedBy))
                {
                    staleOverrides.Add(manualOverride);
                    continue;
                }

                string action = Normalize(manualOverride.Action);
                if (action == "FORCEMATCH")
                {
                    matchedTrades.Add(CreateMatchedTrade(
                        new TradeRecord
                        {
                            TradeId = breakRecord.TradeId,
                            Account = breakRecord.Account,
                            Instrument = breakRecord.Instrument,
                            Quantity = breakRecord.Quantity,
                            SettlementDate = breakRecord.SettlementDate,
                            Currency = breakRecord.Currency
                        },
                        "ManualOverrideMatched",
                        breakRecord.PositionId,
                        breakRecord.SettlementId,
                        manualOverride.Note));
                    breakQueue.Remove(breakRecord);
                }
                else if (action == "SUPPRESSBREAK")
                {
                    matchedTrades.Add(CreateMatchedTrade(
                        new TradeRecord
                        {
                            TradeId = breakRecord.TradeId,
                            Account = breakRecord.Account,
                            Instrument = breakRecord.Instrument,
                            Quantity = breakRecord.Quantity,
                            SettlementDate = breakRecord.SettlementDate,
                            Currency = breakRecord.Currency
                        },
                        "ManualOverrideSuppressed",
                        breakRecord.PositionId,
                        breakRecord.SettlementId,
                        manualOverride.Note));
                    breakQueue.Remove(breakRecord);
                }
                else
                {
                    staleOverrides.Add(manualOverride);
                }
            }

            staleOverrides.AddRange(overrides.Where(record => !resolvedTrades.Contains(Normalize(record.TradeId)) && !staleOverrides.Contains(record)));

            return new ReconciliationResult
            {
                MatchedTrades = matchedTrades.OrderBy(record => record.TradeId, StringComparer.Ordinal).ToList(),
                OpenBreaks = breakQueue.OrderBy(record => record.TradeId, StringComparer.Ordinal).ToList(),
                StaleOverrides = staleOverrides.OrderBy(record => record.TradeId, StringComparer.Ordinal).ToList(),
                TotalTradesRead = trades.Count,
                CanonicalTradeCount = seenTradeIds.Count,
                DuplicateTradeCount = duplicateTradeCount,
                MatchedCount = matchedTrades.Count(record => record.Status == "Matched"),
                ManualOverrideMatchedCount = matchedTrades.Count(record => record.Status == "ManualOverrideMatched"),
                ManualOverrideSuppressedCount = matchedTrades.Count(record => record.Status == "ManualOverrideSuppressed")
            };
        }

        private static PositionRecord FindPosition(TradeRecord trade, IEnumerable<PositionRecord> candidates, ISet<string> usedPositions, ICollection<string> reasons)
        {
            var available = candidates.Where(candidate => !usedPositions.Contains(candidate.PositionId)).ToList();
            if (!available.Any())
            {
                reasons.Add("MissingPosition");
                return null;
            }

            var sameDate = available.Where(candidate => candidate.SettlementDate == trade.SettlementDate).ToList();
            if (!sameDate.Any())
            {
                reasons.Add("PositionSettlementDateMismatch");
                return null;
            }

            var sameCurrency = sameDate.Where(candidate => Normalize(candidate.Currency) == Normalize(trade.Currency)).ToList();
            if (!sameCurrency.Any())
            {
                reasons.Add("PositionCurrencyMismatch");
                return null;
            }

            var candidatePosition = sameCurrency
                .OrderBy(candidate => Math.Abs(candidate.Quantity - trade.Quantity))
                .ThenBy(candidate => candidate.PositionId, StringComparer.Ordinal)
                .First();

            if (Math.Sign((double)candidatePosition.Quantity) != Math.Sign((double)trade.Quantity))
            {
                reasons.Add("PositionQuantitySignMismatch");
                return null;
            }

            if (Math.Abs(candidatePosition.Quantity - trade.Quantity) > BatchConfiguration.PositionQuantityTolerance)
            {
                reasons.Add("PositionQuantityOutOfTolerance");
                return null;
            }

            return candidatePosition;
        }

        private static SettlementRecord FindSettlement(TradeRecord trade, IEnumerable<SettlementRecord> candidates, ISet<string> usedSettlements, ICollection<string> reasons)
        {
            var available = candidates.Where(candidate => !usedSettlements.Contains(candidate.SettlementId)).ToList();
            if (!available.Any())
            {
                reasons.Add("MissingSettlement");
                return null;
            }

            var sameDate = available.Where(candidate => candidate.SettlementDate == trade.SettlementDate).ToList();
            if (!sameDate.Any())
            {
                reasons.Add("SettlementDateMismatch");
                return null;
            }

            var sameCurrency = sameDate.Where(candidate => Normalize(candidate.Currency) == Normalize(trade.Currency)).ToList();
            if (!sameCurrency.Any())
            {
                reasons.Add("SettlementCurrencyMismatch");
                return null;
            }

            var candidateSettlement = sameCurrency
                .OrderBy(candidate => Math.Abs(candidate.Quantity - trade.Quantity))
                .ThenBy(candidate => candidate.SettlementId, StringComparer.Ordinal)
                .First();

            if (Math.Sign((double)candidateSettlement.Quantity) != Math.Sign((double)trade.Quantity))
            {
                reasons.Add("SettlementQuantitySignMismatch");
                return null;
            }

            if (Math.Abs(candidateSettlement.Quantity - trade.Quantity) > BatchConfiguration.SettlementQuantityTolerance)
            {
                reasons.Add("SettlementQuantityOutOfTolerance");
                return null;
            }

            if (Math.Abs(candidateSettlement.CashAmount - trade.NetAmount) > BatchConfiguration.SettlementAmountTolerance)
            {
                reasons.Add("SettlementAmountOutOfTolerance");
                return null;
            }

            return candidateSettlement;
        }

        private static string GetNearestPositionId(TradeRecord trade, IEnumerable<PositionRecord> candidates)
        {
            if (candidates == null)
            {
                return null;
            }

            return candidates
                .OrderBy(candidate => Math.Abs((candidate.SettlementDate - trade.SettlementDate).Ticks))
                .ThenBy(candidate => candidate.PositionId, StringComparer.Ordinal)
                .Select(candidate => candidate.PositionId)
                .FirstOrDefault();
        }

        private static string GetNearestSettlementId(TradeRecord trade, IEnumerable<SettlementRecord> candidates)
        {
            if (candidates == null)
            {
                return null;
            }

            return candidates
                .OrderBy(candidate => Math.Abs((candidate.SettlementDate - trade.SettlementDate).Ticks))
                .ThenBy(candidate => candidate.SettlementId, StringComparer.Ordinal)
                .Select(candidate => candidate.SettlementId)
                .FirstOrDefault();
        }

        private static BreakRecord CreateBreak(TradeRecord trade, string reasons, string positionId, string settlementId, bool canManualOverride)
        {
            return new BreakRecord
            {
                TradeId = Normalize(trade.TradeId),
                Account = Normalize(trade.Account),
                Instrument = Normalize(trade.Instrument),
                Quantity = trade.Quantity,
                SettlementDate = trade.SettlementDate,
                Currency = Normalize(trade.Currency),
                Reasons = reasons,
                PositionId = positionId,
                SettlementId = settlementId,
                CanManualOverride = canManualOverride
            };
        }

        private static MatchedTradeRecord CreateMatchedTrade(TradeRecord trade, string status, string positionId, string settlementId, string note)
        {
            return new MatchedTradeRecord
            {
                TradeId = Normalize(trade.TradeId),
                Status = status,
                Account = Normalize(trade.Account),
                Instrument = Normalize(trade.Instrument),
                Quantity = trade.Quantity,
                SettlementDate = trade.SettlementDate,
                Currency = Normalize(trade.Currency),
                PositionId = positionId,
                SettlementId = settlementId,
                OverrideNote = note
            };
        }

        private static string BuildPairKey(string account, string instrument)
        {
            return Normalize(account) + "|" + Normalize(instrument);
        }

        private static string Normalize(string value)
        {
            return (value ?? string.Empty).Trim().ToUpperInvariant();
        }
    }
}
