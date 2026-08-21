using System;
using System.IO;
using LegacyTradeReconciliation;

namespace LegacyTradeReconciliation.CharacterizationTests
{
    public static class Program
    {
        public static int Main(string[] args)
        {
            RunTest("baseline-golden-master", RunBaselineGoldenMaster);
            RunTest("override-and-rerun", RunOverrideAndRerun);
            RunTest("duplicate-overrides-are-audited", RunDuplicateOverridesAreAudited);
            Console.WriteLine("All characterization tests passed.");
            return 0;
        }

        private static void RunBaselineGoldenMaster()
        {
            string fixtureRoot = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Fixtures", "baseline");
            string outputDirectory = PrepareOutputDirectory("baseline");
            ExecuteBatch(fixtureRoot, outputDirectory);

            AssertFileEquals(
                Path.Combine(fixtureRoot, "expected", "break-queue.csv"),
                Path.Combine(outputDirectory, "break-queue.csv"));
            AssertFileEquals(
                Path.Combine(fixtureRoot, "expected", "end-of-day-report.txt"),
                Path.Combine(outputDirectory, "end-of-day-report.txt"));
        }

        private static void RunOverrideAndRerun()
        {
            string fixtureRoot = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Fixtures", "override-rerun");
            string outputDirectory = PrepareOutputDirectory("override-rerun");
            ExecuteBatch(fixtureRoot, outputDirectory);

            string firstMatchedTrades = File.ReadAllText(Path.Combine(outputDirectory, "matched-trades.csv"));
            string firstReport = File.ReadAllText(Path.Combine(outputDirectory, "end-of-day-report.txt"));
            string firstLedger = File.ReadAllText(Path.Combine(outputDirectory, "run-ledger.csv"));

            AssertFileEquals(
                Path.Combine(fixtureRoot, "expected", "matched-trades.csv"),
                Path.Combine(outputDirectory, "matched-trades.csv"));
            AssertFileEquals(
                Path.Combine(fixtureRoot, "expected", "break-queue.csv"),
                Path.Combine(outputDirectory, "break-queue.csv"));
            AssertFileEquals(
                Path.Combine(fixtureRoot, "expected", "end-of-day-report.txt"),
                Path.Combine(outputDirectory, "end-of-day-report.txt"));

            ExecuteBatch(fixtureRoot, outputDirectory);

            AssertEqual("matched-trades rerun should stay identical", firstMatchedTrades, File.ReadAllText(Path.Combine(outputDirectory, "matched-trades.csv")));
            AssertEqual("report rerun should stay identical", firstReport, File.ReadAllText(Path.Combine(outputDirectory, "end-of-day-report.txt")));
            AssertEqual("ledger rerun should stay identical", firstLedger, File.ReadAllText(Path.Combine(outputDirectory, "run-ledger.csv")));
        }

        private static void RunDuplicateOverridesAreAudited()
        {
            string fixtureRoot = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Fixtures", "override-rerun");
            string workingRoot = PrepareOutputDirectory("duplicate-overrides-input");
            string inputDirectory = Path.Combine(workingRoot, "input");
            string outputDirectory = PrepareOutputDirectory("duplicate-overrides-output");
            Directory.CreateDirectory(inputDirectory);

            foreach (string fileName in new[] { "trades.csv", "positions.csv", "settlements.csv", "overrides.csv" })
            {
                File.Copy(Path.Combine(fixtureRoot, "input", fileName), Path.Combine(inputDirectory, fileName));
            }

            File.AppendAllText(
                Path.Combine(inputDirectory, "overrides.csv"),
                "T-1003,ForceMatch,Superseded duplicate instruction,ops-manager" + Environment.NewLine);

            ExecuteBatch(workingRoot, outputDirectory);

            string report = File.ReadAllText(Path.Combine(outputDirectory, "end-of-day-report.txt"));
            AssertContains("duplicate override count", report, "Stale Overrides: 1");
            AssertContains("duplicate override audit detail", report, "T-1003: ForceMatch (ops-manager)");
        }

        private static void ExecuteBatch(string fixtureRoot, string outputDirectory)
        {
            int exitCode = new ReconciliationBatch().Run(new[]
            {
                "2025-03-17",
                Path.Combine(fixtureRoot, "input"),
                outputDirectory
            });

            if (exitCode != 0)
            {
                throw new InvalidOperationException("Batch exited with code " + exitCode + ".");
            }
        }

        private static string PrepareOutputDirectory(string name)
        {
            string directory = Path.Combine(Path.GetTempPath(), "legacy-trade-reconciliation-tests", name);
            if (Directory.Exists(directory))
            {
                Directory.Delete(directory, true);
            }

            Directory.CreateDirectory(directory);
            return directory;
        }

        private static void AssertFileEquals(string expectedPath, string actualPath)
        {
            AssertEqual(Path.GetFileName(actualPath), File.ReadAllText(expectedPath), File.ReadAllText(actualPath));
        }

        private static void AssertEqual(string label, string expected, string actual)
        {
            if (!string.Equals(expected, actual, StringComparison.Ordinal))
            {
                throw new InvalidOperationException(label + " mismatch." + Environment.NewLine +
                    "Expected:" + Environment.NewLine +
                    expected + Environment.NewLine +
                    "Actual:" + Environment.NewLine +
                    actual);
            }
        }

        private static void AssertContains(string label, string actual, string expectedFragment)
        {
            if (actual.IndexOf(expectedFragment, StringComparison.Ordinal) < 0)
            {
                throw new InvalidOperationException(label + " missing expected text: " + expectedFragment);
            }
        }

        private static void RunTest(string name, Action action)
        {
            try
            {
                action();
                Console.WriteLine("[PASS] " + name);
            }
            catch (Exception exception)
            {
                Console.WriteLine("[FAIL] " + name);
                Console.WriteLine(exception.Message);
                Environment.Exit(1);
            }
        }
    }
}
