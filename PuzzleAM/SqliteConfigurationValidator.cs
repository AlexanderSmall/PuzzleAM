using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;
using System;
using System.IO;
using System.Linq;

namespace PuzzleAM;

internal static class SqliteConfigurationValidator
{
    internal static Func<string, DirectoryInfo> DirectoryCreator
    {
        get => _directoryCreator;
        set => _directoryCreator = value ?? throw new ArgumentNullException(nameof(value));
    }

    private static Func<string, DirectoryInfo> _directoryCreator = Directory.CreateDirectory;

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
            sqliteBuilder.DataSource = NormalizeDataSource(sqliteBuilder.DataSource);

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

    private static string NormalizeDataSource(string dataSource)
    {
        var fileName = Path.GetFileName(dataSource);
        if (string.IsNullOrEmpty(fileName))
        {
            fileName = "PuzzleAM.db";
        }

        if (!Path.IsPathRooted(dataSource))
        {
            var defaultDataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "PuzzleAM");
            if (TryEnsureDirectory(defaultDataDirectory, out _))
            {
                dataSource = Path.Combine(defaultDataDirectory, fileName);
            }
            else
            {
                return EnsureFallbackDataSource(fileName);
            }
        }

        var dataDirectory = Path.GetDirectoryName(dataSource);
        if (!string.IsNullOrEmpty(dataDirectory) && !TryEnsureDirectory(dataDirectory, out _))
        {
            return EnsureFallbackDataSource(fileName);
        }

        return dataSource;
    }

    private static string EnsureFallbackDataSource(string fileName)
    {
        var fallbackDirectory = Path.Combine(Path.GetTempPath(), "PuzzleAM");
        if (!TryEnsureDirectory(fallbackDirectory, out var failure))
        {
            throw new InvalidOperationException($"Unable to create the fallback data directory '{fallbackDirectory}'.", failure);
        }

        return Path.Combine(fallbackDirectory, fileName);
    }

    private static bool TryEnsureDirectory(string path, out Exception? failure)
    {
        try
        {
            DirectoryCreator(path);
            failure = null;
            return true;
        }
        catch (Exception ex) when (ex is UnauthorizedAccessException or IOException or NotSupportedException)
        {
            failure = ex;
            return false;
        }
    }
}
