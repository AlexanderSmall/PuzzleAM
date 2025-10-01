using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;
using System;
using System.IO;
using System.Linq;

namespace PuzzleAM;

internal static class SqliteConfigurationValidator
{
    private static readonly string[] NonSqliteTokens =
    [
        "Host=",
        "Server=",
        "Username=",
        "User Id=",
        "UserId=",
        "Password=",
        "Port=",
        "Ssl Mode=",
        "SSL Mode=",
        "Integrated Security=",
        "Database="
    ];

    internal static string ValidateAndNormalizeConnectionString(string connectionString, string databaseProvider, ILogger logger)
    {
        ArgumentNullException.ThrowIfNull(connectionString);
        ArgumentNullException.ThrowIfNull(logger);

        if (LooksLikeNonSqliteConnectionString(connectionString))
        {
            var message =
                $"The configured database provider '{databaseProvider}' expects a SQLite connection string, but the supplied value appears to target a different database engine. Set 'Database:Provider' to 'Postgres' or provide a valid SQLite connection string.";
            logger.LogError(
                "{Message} Provider={Provider}; ConnectionString={ConnectionString}",
                message,
                databaseProvider,
                connectionString);
            throw new InvalidOperationException(message);
        }

        try
        {
            var sqliteBuilder = new SqliteConnectionStringBuilder(connectionString);
            var originalDataSource = sqliteBuilder.DataSource;

            if (!string.Equals(originalDataSource, ":memory:", StringComparison.OrdinalIgnoreCase))
            {
                if (!Path.IsPathRooted(originalDataSource))
                {
                    var dataDirectory = EnsureDefaultDataDirectory(logger, connectionString, databaseProvider);
                    sqliteBuilder.DataSource = Path.Combine(dataDirectory, Path.GetFileName(originalDataSource));
                }
                else
                {
                    EnsureExplicitDataDirectory(originalDataSource, logger, connectionString, databaseProvider);
                }
            }

            return sqliteBuilder.ConnectionString;
        }
        catch (ArgumentException ex)
        {
            var message =
                $"The configured database provider '{databaseProvider}' expects a valid SQLite connection string, but parsing the supplied value failed. Update 'Database:Provider' or correct the connection string.";
            logger.LogError(
                ex,
                "{Message} Provider={Provider}; ConnectionString={ConnectionString}",
                message,
                databaseProvider,
                connectionString);
            throw new InvalidOperationException(message, ex);
        }
    }

    private static bool LooksLikeNonSqliteConnectionString(string connectionString)
    {
        return NonSqliteTokens.Any(token => connectionString.IndexOf(token, StringComparison.OrdinalIgnoreCase) >= 0);
    }

    private static string EnsureDefaultDataDirectory(ILogger logger, string connectionString, string databaseProvider)
    {
        var defaultDataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "PuzzleAM");

        if (TryEnsureDirectory(defaultDataDirectory, out var creationError))
        {
            return defaultDataDirectory;
        }

        var fallbackDataDirectory = Path.Combine(Path.GetTempPath(), "PuzzleAM");
        if (TryEnsureDirectory(fallbackDataDirectory, out var fallbackError))
        {
            logger.LogWarning(
                creationError,
                "Falling back to temporary data directory {FallbackDirectory} after failing to ensure {DefaultDirectory}. Provider={Provider}; ConnectionString={ConnectionString}",
                fallbackDataDirectory,
                defaultDataDirectory,
                databaseProvider,
                connectionString);
            return fallbackDataDirectory;
        }

        var message =
            $"The configured database provider '{databaseProvider}' could not ensure a writable directory for the SQLite data source. Review the connection string and file system permissions.";
        var failure = fallbackError ?? creationError!;
        logger.LogError(
            failure,
            "{Message} Provider={Provider}; ConnectionString={ConnectionString}",
            message,
            databaseProvider,
            connectionString);
        throw new InvalidOperationException(message, failure);
    }

    private static void EnsureExplicitDataDirectory(string dataSource, ILogger logger, string connectionString, string databaseProvider)
    {
        var dataDirectory = Path.GetDirectoryName(dataSource);
        if (string.IsNullOrEmpty(dataDirectory))
        {
            return;
        }

        if (TryEnsureDirectory(dataDirectory, out var exception))
        {
            return;
        }

        var message =
            $"The configured SQLite data directory '{dataDirectory}' for provider '{databaseProvider}' could not be created or accessed. Adjust the connection string or fix the directory permissions.";
        logger.LogError(
            exception,
            "{Message} Provider={Provider}; ConnectionString={ConnectionString}; DataDirectory={DataDirectory}",
            message,
            databaseProvider,
            connectionString,
            dataDirectory);
        throw new InvalidOperationException(message, exception);
    }

    private static bool TryEnsureDirectory(string? directory, out Exception? exception)
    {
        try
        {
            if (string.IsNullOrEmpty(directory))
            {
                exception = null;
                return true;
            }

            Directory.CreateDirectory(directory);
            exception = null;
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException or PathTooLongException or System.Security.SecurityException or DirectoryNotFoundException)
        {
            exception = ex;
            return false;
        }
    }
}
