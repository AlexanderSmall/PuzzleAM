using Microsoft.Extensions.Configuration;
using PuzzleAM;
using System.Collections.Generic;
using Xunit;

namespace PuzzleAM.Tests;

public class DatabaseConfigurationTests
{
    [Fact]
    public void GetDatabaseProvider_UsesDatabaseProviderSetting()
    {
        var configuration = BuildConfiguration(new Dictionary<string, string?>
        {
            ["Database:Provider"] = "Postgres"
        });

        var provider = DatabaseConfiguration.GetDatabaseProvider(configuration);

        Assert.Equal("Postgres", provider);
    }

    [Fact]
    public void GetDatabaseProvider_FallsBackToEnvironmentVariableStyleKey()
    {
        var configuration = BuildConfiguration(new Dictionary<string, string?>
        {
            ["DATABASE_PROVIDER"] = "Postgres"
        });

        var provider = DatabaseConfiguration.GetDatabaseProvider(configuration);

        Assert.Equal("Postgres", provider);
    }

    [Fact]
    public void GetDatabaseProvider_DefaultsToSqlite()
    {
        var configuration = BuildConfiguration();

        var provider = DatabaseConfiguration.GetDatabaseProvider(configuration);

        Assert.Equal("Sqlite", provider);
    }

    [Fact]
    public void GetConnectionString_UsesConfiguredConnectionString()
    {
        var configuration = BuildConfiguration(new Dictionary<string, string?>
        {
            ["ConnectionStrings:DefaultConnection"] = "Host=/cloudsql/example" 
        });

        var connectionString = DatabaseConfiguration.GetConnectionString(configuration);

        Assert.Equal("Host=/cloudsql/example", connectionString);
    }

    [Fact]
    public void GetConnectionString_FallsBackToEnvironmentVariableStyleKey()
    {
        var configuration = BuildConfiguration(new Dictionary<string, string?>
        {
            ["DATABASE_CONNECTION_STRING"] = "Host=/cloudsql/example"
        });

        var connectionString = DatabaseConfiguration.GetConnectionString(configuration);

        Assert.Equal("Host=/cloudsql/example", connectionString);
    }

    [Fact]
    public void GetConnectionString_DefaultsToSqliteFile()
    {
        var configuration = BuildConfiguration();

        var connectionString = DatabaseConfiguration.GetConnectionString(configuration);

        Assert.Equal("Data Source=app.db", connectionString);
    }

    private static IConfiguration BuildConfiguration(IDictionary<string, string?>? values = null)
    {
        return new ConfigurationBuilder()
            .AddInMemoryCollection(values ?? new Dictionary<string, string?>())
            .Build();
    }
}
