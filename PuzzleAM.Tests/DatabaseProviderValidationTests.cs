using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;
using PuzzleAM;
using System;
using System.Collections.Generic;
using System.Linq;
using System.IO;
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
    public void ValidateAndNormalizeConnectionString_UsesFallbackDirectoryWhenPrimaryCreationFails()
    {
        const string provider = "Sqlite";
        const string connectionString = "Data Source=puzzle.db";
        var logger = new TestLogger();

        var defaultDataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "PuzzleAM");
        var fallbackDirectory = Path.Combine(Path.GetTempPath(), "PuzzleAM");
        var attemptedDirectories = new List<string>();

        var originalCreator = SqliteConfigurationValidator.DirectoryCreator;
        try
        {
            SqliteConfigurationValidator.DirectoryCreator = path =>
            {
                attemptedDirectories.Add(path);
                if (string.Equals(path, defaultDataDirectory, StringComparison.OrdinalIgnoreCase))
                {
                    throw new UnauthorizedAccessException("Access denied for testing");
                }

                return new DirectoryInfo(path);
            };

            var normalized = SqliteConfigurationValidator.ValidateAndNormalizeConnectionString(connectionString, provider, logger);
            var builder = new SqliteConnectionStringBuilder(normalized);

            Assert.Equal(Path.Combine(fallbackDirectory, "puzzle.db"), builder.DataSource);
            Assert.Contains(defaultDataDirectory, attemptedDirectories);
            Assert.Contains(fallbackDirectory, attemptedDirectories);
        }
        finally
        {
            SqliteConfigurationValidator.DirectoryCreator = originalCreator;
        }
    }

    [Fact]
    public void ValidateAndNormalizeConnectionString_ThrowsWhenAbsoluteDirectoryCreationFails()
    {
        const string provider = "Sqlite";
        var absolutePath = Path.Combine(Path.GetTempPath(), "PuzzleAMTests", "custom", "puzzle.db");
        var connectionString = $"Data Source={absolutePath}";
        var logger = new TestLogger();

        var dataDirectory = Path.GetDirectoryName(absolutePath)!;

        var originalCreator = SqliteConfigurationValidator.DirectoryCreator;
        try
        {
            SqliteConfigurationValidator.DirectoryCreator = path =>
            {
                if (string.Equals(path, dataDirectory, StringComparison.OrdinalIgnoreCase))
                {
                    throw new UnauthorizedAccessException("Access denied for testing");
                }

                return new DirectoryInfo(path);
            };

            var exception = Assert.Throws<InvalidOperationException>(() =>
                SqliteConfigurationValidator.ValidateAndNormalizeConnectionString(connectionString, provider, logger));

            Assert.Contains(dataDirectory, exception.Message, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            SqliteConfigurationValidator.DirectoryCreator = originalCreator;
        }
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
