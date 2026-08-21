using System;
using System.Globalization;
using System.IO;

namespace LegacyTradeReconciliation
{
    public sealed class RunRequest
    {
        public DateTime BusinessDate { get; set; }
        public string InputDirectory { get; set; }
        public string OutputDirectory { get; set; }

        public static RunRequest Resolve(string[] args)
        {
            if (args == null || args.Length == 0)
            {
                string baseDirectory = AppDomain.CurrentDomain.BaseDirectory;
                return new RunRequest
                {
                    BusinessDate = new DateTime(2025, 3, 17),
                    InputDirectory = Path.Combine(baseDirectory, "data", "sample"),
                    OutputDirectory = Path.Combine(baseDirectory, "output", "sample")
                };
            }

            if (args.Length != 3)
            {
                throw new ArgumentException("Expected either no arguments or: <business-date yyyy-MM-dd> <input-directory> <output-directory>.");
            }

            return new RunRequest
            {
                BusinessDate = DateTime.ParseExact(args[0], "yyyy-MM-dd", CultureInfo.InvariantCulture),
                InputDirectory = Path.GetFullPath(args[1]),
                OutputDirectory = Path.GetFullPath(args[2])
            };
        }
    }
}
