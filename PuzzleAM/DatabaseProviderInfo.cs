using System;

namespace PuzzleAM;

public sealed class DatabaseProviderInfo
{
    public DatabaseProviderInfo(string configuredProvider)
    {
        ConfiguredProvider = configuredProvider;
        ProviderDisplayName = NormalizeProviderName(configuredProvider);
    }

    public string ConfiguredProvider { get; }

    public string ProviderDisplayName { get; }

    public string ProviderDescription => ProviderDisplayName switch
    {
        "SQLite" => "SQLite database",
        "PostgreSQL" => "PostgreSQL database",
        _ => $"{ProviderDisplayName} database"
    };

    private static string NormalizeProviderName(string configuredProvider)
    {
        if (string.IsNullOrWhiteSpace(configuredProvider))
        {
            return "SQLite";
        }

        if (string.Equals(configuredProvider, "Sqlite", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(configuredProvider, "Microsoft.Data.Sqlite", StringComparison.OrdinalIgnoreCase))
        {
            return "SQLite";
        }

        if (string.Equals(configuredProvider, "Postgres", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(configuredProvider, "PostgreSQL", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(configuredProvider, "Npgsql", StringComparison.OrdinalIgnoreCase))
        {
            return "PostgreSQL";
        }

        return configuredProvider;
    }
}
