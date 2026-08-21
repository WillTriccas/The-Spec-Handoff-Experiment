using System.Globalization;

namespace TradeRecon.Infrastructure.Sources;

/// <summary>
/// Minimal, allocation-friendly CSV parsing sufficient for the synthetic fixtures used by
/// this baseline. Supports double-quoted fields with escaped quotes and skips blank lines.
/// </summary>
internal static class CsvReader
{
    internal static IReadOnlyList<IReadOnlyDictionary<string, string>> Read(
        string content,
        IReadOnlyCollection<string> requiredColumns)
    {
        var rows = new List<IReadOnlyDictionary<string, string>>();
        var lines = content.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');

        string[]? header = null;
        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            var fields = ParseLine(line);
            if (header is null)
            {
                header = fields.Select(f => f.Trim()).ToArray();
                if (header.Any(string.IsNullOrWhiteSpace) ||
                    header.Distinct(StringComparer.OrdinalIgnoreCase).Count() != header.Length)
                {
                    throw new FormatException("CSV header contains an empty or duplicate column.");
                }
                var headerSet = header.ToHashSet(StringComparer.OrdinalIgnoreCase);
                var missingColumns = requiredColumns.Where(column => !headerSet.Contains(column)).ToArray();
                if (missingColumns.Length > 0)
                {
                    throw new FormatException(
                        $"CSV header is missing required column(s): {string.Join(", ", missingColumns)}.");
                }
                continue;
            }

            if (fields.Count != header.Length)
            {
                throw new FormatException(
                    $"CSV row has {fields.Count} fields but the header declares {header.Length}.");
            }

            var row = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (var i = 0; i < header.Length; i++)
            {
                row[header[i]] = i < fields.Count ? fields[i] : string.Empty;
            }

            rows.Add(row);
        }

        if (header is null)
        {
            throw new FormatException("CSV input does not contain a header row.");
        }

        return rows;
    }

    private static List<string> ParseLine(string line)
    {
        var fields = new List<string>();
        var current = new System.Text.StringBuilder();
        var inQuotes = false;

        for (var i = 0; i < line.Length; i++)
        {
            var c = line[i];
            if (inQuotes)
            {
                if (c == '"')
                {
                    if (i + 1 < line.Length && line[i + 1] == '"')
                    {
                        current.Append('"');
                        i++;
                    }
                    else
                    {
                        inQuotes = false;
                    }
                }
                else
                {
                    current.Append(c);
                }
            }
            else if (c == '"')
            {
                inQuotes = true;
            }
            else if (c == ',')
            {
                fields.Add(current.ToString());
                current.Clear();
            }
            else
            {
                current.Append(c);
            }
        }

        if (inQuotes)
        {
            throw new FormatException("CSV row contains an unterminated quoted field.");
        }

        fields.Add(current.ToString());
        return fields;
    }

    internal static decimal Decimal(IReadOnlyDictionary<string, string> row, string column)
        => decimal.Parse(Required(row, column), NumberStyles.Number, CultureInfo.InvariantCulture);

    internal static decimal PositiveDecimal(
        IReadOnlyDictionary<string, string> row,
        string column)
    {
        var value = Decimal(row, column);
        if (value <= 0)
        {
            throw new FormatException($"CSV column '{column}' must be greater than zero.");
        }

        return value;
    }

    internal static DateOnly Date(IReadOnlyDictionary<string, string> row, string column)
        => DateOnly.ParseExact(Required(row, column), "yyyy-MM-dd", CultureInfo.InvariantCulture);

    internal static string Text(IReadOnlyDictionary<string, string> row, string column)
        => Required(row, column);

    private static string Required(IReadOnlyDictionary<string, string> row, string column)
    {
        if (!row.TryGetValue(column, out var value))
        {
            throw new FormatException($"CSV input is missing required column '{column}'.");
        }

        return value.Trim();
    }
}
