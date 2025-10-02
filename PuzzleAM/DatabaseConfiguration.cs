using Microsoft.Extensions.Configuration;
using System;

namespace PuzzleAM;

internal static class DatabaseConfiguration
{
    private const string DefaultProvider = "Sqlite";
    private const string DatabaseProviderKey = "Database:Provider";
    private const string DatabaseProviderEnvironmentFallbackKey = "DATABASE_PROVIDER";
    private const string DefaultConnectionName = "DefaultConnection";
    private const string ConnectionStringFallbackKey = "DATABASE_CONNECTION_STRING";

    public static string GetDatabaseProvider(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        var provider = configuration[DatabaseProviderKey];

        if (string.IsNullOrWhiteSpace(provider))
        {
            provider = configuration[DatabaseProviderEnvironmentFallbackKey];
        }

        return string.IsNullOrWhiteSpace(provider) ? DefaultProvider : provider;
    }

    public static string GetConnectionString(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        var connectionString = configuration.GetConnectionString(DefaultConnectionName);

        if (string.IsNullOrWhiteSpace(connectionString))
        {
            connectionString = configuration[ConnectionStringFallbackKey];
        }

        return string.IsNullOrWhiteSpace(connectionString)
            ? "Data Source=app.db"
            : connectionString;
    }
}
