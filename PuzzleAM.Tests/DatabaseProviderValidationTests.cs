using Microsoft.Extensions.Logging;
using PuzzleAM;
using System;
using System.Collections.Generic;
using System.Linq;
using Xunit;

namespace PuzzleAM.Tests;

public class DatabaseProviderValidationTests
{
    [Fact]
    public void ValidateAndNormalizeConnectionString_ThrowsForPostgresConnectionString()
    {
        const string provider = "Sqlite";
        const string connectionString = "Host=localhost;Port=5432;Database=puzzleam;Username=postgres;Password=secret";
        var logger = new TestLogger();

        var exception = Assert.Throws<InvalidOperationException>(
            () => SqliteConfigurationValidator.ValidateAndNormalizeConnectionString(connectionString, provider, logger));

        Assert.Contains("Database:Provider", exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(provider, exception.Message, StringComparison.OrdinalIgnoreCase);

        var logEntry = Assert.Single(logger.Entries);
        Assert.Equal(LogLevel.Error, logEntry.LogLevel);
        Assert.Contains(provider, logEntry.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Host=localhost", logEntry.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ValidateAndNormalizeConnectionString_ThrowsWhenAbsolutePathCannotBeEnsured()
    {
        const string provider = "Sqlite";
        const string connectionString = "Data Source=/dev/null/puzzleam.db";
        var logger = new TestLogger();

        var exception = Assert.Throws<InvalidOperationException>(
            () => SqliteConfigurationValidator.ValidateAndNormalizeConnectionString(connectionString, provider, logger));

        Assert.Contains("/dev/null", exception.Message, StringComparison.OrdinalIgnoreCase);

        var errorLog = Assert.Single(logger.Entries.Where(entry => entry.LogLevel == LogLevel.Error));
        Assert.Contains("/dev/null", errorLog.Message, StringComparison.OrdinalIgnoreCase);
    }

    private sealed class TestLogger : ILogger
    {
        public List<TestLogEntry> Entries { get; } = new();

        public IDisposable BeginScope<TState>(TState state) where TState : notnull => NullScope.Instance;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            Entries.Add(new TestLogEntry(logLevel, formatter(state, exception)));
        }

        private sealed class NullScope : IDisposable
        {
            public static readonly NullScope Instance = new();

            public void Dispose()
            {
            }
        }
    }

    public sealed record TestLogEntry(LogLevel LogLevel, string Message);
}
