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
            if (!Path.IsPathRooted(sqliteBuilder.DataSource))
            {
                var defaultDataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "PuzzleAM");
                Directory.CreateDirectory(defaultDataDirectory);
                sqliteBuilder.DataSource = Path.Combine(defaultDataDirectory, Path.GetFileName(sqliteBuilder.DataSource));
            }

            var dataDirectory = Path.GetDirectoryName(sqliteBuilder.DataSource);
            if (!string.IsNullOrEmpty(dataDirectory))
            {
                Directory.CreateDirectory(dataDirectory);
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
}
