using TradeRecon.Console;
using Xunit;

namespace TradeRecon.Tests;

public class CliContractTests
{
    [Theory]
    [InlineData("--date", "not-a-date")]
    [InlineData("--unknown", "value")]
    public async Task InvalidArguments_ReturnDocumentedErrorCode(string option, string value)
    {
        var exitCode = await Program.Main([option, value]);

        Assert.Equal(Program.ExitError, exitCode);
    }

    [Fact]
    public async Task MissingArgumentValue_ReturnsDocumentedErrorCode()
    {
        var exitCode = await Program.Main(["--fixtures"]);

        Assert.Equal(Program.ExitError, exitCode);
    }

    [Fact]
    public async Task MissingRequiredCsvHeader_ReturnsDocumentedErrorCode()
        => await AssertMalformedTradesReturnError(
            trades => trades.Replace("TradeId", "MissingTradeId"));

    [Fact]
    public async Task HeaderOnlyFileWithWrongColumns_ReturnsDocumentedErrorCode()
        => await AssertMalformedTradesReturnError(_ => "NotTheExpectedHeader\n");

    [Fact]
    public async Task MissingHeaderIsRejectedWhenEveryRowIsOutsideTheRequestedDate()
        => await AssertMalformedTradesReturnError(trades =>
        {
            var lines = trades.Replace("\r\n", "\n").Split('\n');
            var header = lines[0].Split(',').ToList();
            var amountIndex = header.IndexOf("Amount");
            header.RemoveAt(amountIndex);

            var filteredRows = lines
                .Skip(1)
                .Where(line => !string.IsNullOrWhiteSpace(line))
                .Select(line =>
                {
                    var fields = line.Split(',').ToList();
                    fields[0] = "1999-01-01";
                    fields.RemoveAt(amountIndex);
                    return string.Join(',', fields);
                });

            return string.Join('\n', new[] { string.Join(',', header) }.Concat(filteredRows));
        });

    [Fact]
    public async Task BlankCsvFile_ReturnsDocumentedErrorCode()
        => await AssertMalformedTradesReturnError(_ => "\r\n  \r\n");

    [Fact]
    public async Task ExtraCsvField_ReturnsDocumentedErrorCode()
        => await AssertMalformedTradesReturnError(trades =>
        {
            var lines = trades.Replace("\r\n", "\n").Split('\n');
            lines[1] = $"{lines[1]},unexpected";
            return string.Join('\n', lines);
        });

    [Fact]
    public async Task UnterminatedQuotedCsvField_ReturnsDocumentedErrorCode()
        => await AssertMalformedTradesReturnError(trades =>
        {
            var lines = trades.Replace("\r\n", "\n").Split('\n');
            lines[1] = $"\"{lines[1]}";
            return string.Join('\n', lines);
        });

    [Theory]
    [InlineData(4, "0")]
    [InlineData(4, "-1")]
    [InlineData(8, "0")]
    [InlineData(8, "-0.01")]
    public async Task NonPositiveTradeQuantityOrAmount_ReturnsDocumentedErrorCode(
        int fieldIndex,
        string invalidValue)
        => await AssertMalformedTradesReturnError(trades =>
        {
            var lines = trades.Replace("\r\n", "\n").Split('\n');
            var fields = lines[1].Split(',');
            fields[fieldIndex] = invalidValue;
            lines[1] = string.Join(',', fields);
            return string.Join('\n', lines);
        });

    [Theory]
    [InlineData(5, "0")]
    [InlineData(5, "-1")]
    [InlineData(9, "0")]
    [InlineData(9, "-0.01")]
    public async Task NonPositiveSettlementQuantityOrAmount_ReturnsDocumentedErrorCode(
        int fieldIndex,
        string invalidValue)
        => await AssertMalformedFixtureReturnsError("settlements.csv", settlements =>
        {
            var lines = settlements.Replace("\r\n", "\n").Split('\n');
            var fields = lines[1].Split(',');
            fields[fieldIndex] = invalidValue;
            lines[1] = string.Join(',', fields);
            return string.Join('\n', lines);
        });

    private static async Task AssertMalformedTradesReturnError(Func<string, string> mutate)
        => await AssertMalformedFixtureReturnsError("trades.csv", mutate);

    private static async Task AssertMalformedFixtureReturnsError(
        string fixtureName,
        Func<string, string> mutate)
    {
        var tempRoot = Path.Combine(Path.GetTempPath(), $"trade-recon-cli-{Guid.NewGuid():N}");
        var fixtures = Path.Combine(tempRoot, "fixtures");
        var output = Path.Combine(tempRoot, "output");
        Directory.CreateDirectory(fixtures);

        try
        {
            foreach (var name in new[] { "trades.csv", "settlements.csv", "positions.csv" })
            {
                File.Copy(Path.Combine(AppContext.BaseDirectory, "fixtures", name), Path.Combine(fixtures, name));
            }

            var fixturePath = Path.Combine(fixtures, fixtureName);
            var fixture = await File.ReadAllTextAsync(fixturePath);
            await File.WriteAllTextAsync(fixturePath, mutate(fixture));

            var exitCode = await Program.Main(["--fixtures", fixtures, "--out", output]);

            Assert.Equal(Program.ExitError, exitCode);
        }
        finally
        {
            Directory.Delete(tempRoot, recursive: true);
        }
    }
}
