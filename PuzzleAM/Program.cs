using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql.EntityFrameworkCore.PostgreSQL;
using PuzzleAM;
using PuzzleAM.Components;
using PuzzleAM.Hubs;
using PuzzleAM.ViewServices;
using System;
using System.Collections.Generic;
using System.Data;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Security.Claims;
using System.Text;
using System.Text.RegularExpressions;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();

builder.Services.AddScoped<ModalService>();
builder.Services.AddSignalR(o =>
    o.MaximumReceiveMessageSize = 10 * 1024 * 1024);
builder.Services.AddScoped(sp => new HttpClient
    {
        BaseAddress = new Uri(sp.GetRequiredService<NavigationManager>().BaseUri)
    });

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection") ?? "Data Source=app.db";
var databaseProvider = builder.Configuration["Database:Provider"] ?? "Sqlite";

builder.Services.AddSingleton(new DatabaseProviderInfo(databaseProvider));

var sqliteValidationLock = new object();
var sqliteConfigurationValidated = false;
string? normalizedSqliteConnectionString = null;

builder.Services.AddHttpContextAccessor();

builder.Services.AddDbContext<ApplicationDbContext>((serviceProvider, options) =>
{
    if (string.Equals(databaseProvider, "Sqlite", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(databaseProvider, "Microsoft.Data.Sqlite", StringComparison.OrdinalIgnoreCase))
    {
        if (!sqliteConfigurationValidated)
        {
            lock (sqliteValidationLock)
            {
                if (!sqliteConfigurationValidated)
                {
                    var logger = serviceProvider.GetRequiredService<ILogger<Program>>();
                    normalizedSqliteConnectionString = SqliteConfigurationValidator.ValidateAndNormalizeConnectionString(
                        connectionString,
                        databaseProvider,
                        logger);
                    sqliteConfigurationValidated = true;
                }
            }
        }

        options.UseSqlite(normalizedSqliteConnectionString ?? connectionString);
    }
    else if (string.Equals(databaseProvider, "Postgres", StringComparison.OrdinalIgnoreCase) ||
             string.Equals(databaseProvider, "PostgreSQL", StringComparison.OrdinalIgnoreCase) ||
             string.Equals(databaseProvider, "Npgsql", StringComparison.OrdinalIgnoreCase))
    {
        options.UseNpgsql(connectionString);
    }
    else
    {
        throw new InvalidOperationException($"Unsupported database provider '{databaseProvider}'.");
    }
});
builder.Services.AddIdentityCore<IdentityUser>()
    .AddEntityFrameworkStores<ApplicationDbContext>()
    .AddSignInManager();
builder.Services.AddAuthentication(IdentityConstants.ApplicationScheme)
    .AddCookie(IdentityConstants.ApplicationScheme);
builder.Services.AddAuthorization();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    if (db.Database.IsSqlite())
    {
        var connection = db.Database.GetDbConnection();
        var shouldCloseConnection = connection.State != ConnectionState.Open;
        if (shouldCloseConnection)
        {
            connection.Open();
        }

        try
        {
            using var historyExistsCommand = connection.CreateCommand();
            historyExistsCommand.CommandText = "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__EFMigrationsHistory'";
            var historyExists = historyExistsCommand.ExecuteScalar() != null;

            using var schemaExistsCommand = connection.CreateCommand();
            schemaExistsCommand.CommandText = "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'AspNetUsers'";
            var schemaExists = schemaExistsCommand.ExecuteScalar() != null;

            if (!historyExists && schemaExists)
            {
                using (var createHistoryTable = connection.CreateCommand())
                {
                    createHistoryTable.CommandText = "CREATE TABLE IF NOT EXISTS \"__EFMigrationsHistory\" (\"MigrationId\" TEXT NOT NULL CONSTRAINT \"PK___EFMigrationsHistory\" PRIMARY KEY, \"ProductVersion\" TEXT NOT NULL)";
                    createHistoryTable.ExecuteNonQuery();
                }

                using (var insertBaseline = connection.CreateCommand())
                {
                    insertBaseline.CommandText = "INSERT OR IGNORE INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\") VALUES ($id, $productVersion)";
                    var idParameter = insertBaseline.CreateParameter();
                    idParameter.ParameterName = "$id";
                    idParameter.Value = "20240909000000_InitialCreate";
                    insertBaseline.Parameters.Add(idParameter);

                    var productVersionParameter = insertBaseline.CreateParameter();
                    productVersionParameter.ParameterName = "$productVersion";
                    productVersionParameter.Value = "8.0.7";
                    insertBaseline.Parameters.Add(productVersionParameter);

                    insertBaseline.ExecuteNonQuery();
                }
            }
        }
        finally
        {
            if (shouldCloseConnection)
            {
                connection.Close();
            }
        }
    }
    db.Database.Migrate();

    if (db.Database.IsSqlite())
    {
        const string tableName = "AspNetUsers";
        var connection = db.Database.GetDbConnection();
        var connectionWasClosed = connection.State != ConnectionState.Open;
        if (connectionWasClosed)
        {
            connection.Open();
        }

        var reopenAfterEnsureCreated = false;

        try
        {
            bool TableExists()
            {
                using var command = connection.CreateCommand();
                command.CommandText = "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = $name;";
                var nameParameter = command.CreateParameter();
                nameParameter.ParameterName = "$name";
                nameParameter.Value = tableName;
                command.Parameters.Add(nameParameter);
                return command.ExecuteScalar() != null;
            }

            logger.LogInformation("Validating existence of {TableName} after migrations.", tableName);
            var tableExists = TableExists();
            if (!tableExists)
            {
                logger.LogWarning("{TableName} was not found after migrations. Attempting EnsureCreated to repair the schema.", tableName);
                db.Database.EnsureCreated();

                if (connection.State != ConnectionState.Open)
                {
                    connection.Open();
                    reopenAfterEnsureCreated = true;
                }

                tableExists = TableExists();
                if (!tableExists && connection is SqliteConnection sqliteConnection)
                {
                    logger.LogWarning("EnsureCreated did not create the expected table {TableName}. Attempting to rebuild the SQLite database file.", tableName);

                    var sqliteConnectionBuilder = new SqliteConnectionStringBuilder(sqliteConnection.ConnectionString);
                    var dataSource = sqliteConnectionBuilder.DataSource;
                    if (!string.IsNullOrEmpty(dataSource) && !string.Equals(dataSource, ":memory:", StringComparison.OrdinalIgnoreCase))
                    {
                        var databasePath = Path.IsPathRooted(dataSource)
                            ? dataSource
                            : Path.GetFullPath(dataSource);

                        if (connection.State == ConnectionState.Open)
                        {
                            connection.Close();
                        }

                        SqliteConnection.ClearPool(sqliteConnection);

                        if (File.Exists(databasePath))
                        {
                            File.Delete(databasePath);
                            logger.LogInformation("Deleted SQLite database file at {DatabasePath} to allow schema recreation.", databasePath);
                        }
                        else
                        {
                            logger.LogInformation("SQLite database file {DatabasePath} did not exist when attempting to rebuild it.", databasePath);
                        }

                        db.Database.Migrate();

                        connection.Open();
                        reopenAfterEnsureCreated = true;
                        tableExists = TableExists();
                    }
                }

                if (!tableExists)
                {
                    logger.LogWarning("Attempting to create {TableName} via the relational database creator as a final fallback.", tableName);

                    if (connection.State == ConnectionState.Open)
                    {
                        connection.Close();
                    }

                    var databaseCreator = db.Database.GetService<IRelationalDatabaseCreator>();
                    var createScript = db.Database.GenerateCreateScript();
                    var statementsForTable = ExtractCreateStatementsForTable(createScript, tableName).ToList();

                    if (statementsForTable.Count > 0)
                    {
                        logger.LogWarning("Attempting targeted recreation of {TableName} using generated create script.", tableName);

                        foreach (var statement in statementsForTable)
                        {
                            db.Database.ExecuteSqlRaw(statement);
                        }

                        connection.Open();
                        reopenAfterEnsureCreated = true;
                        tableExists = TableExists();
                    }
                    else if (databaseCreator is not null)
                    {
                        databaseCreator.CreateTables();

                        connection.Open();
                        reopenAfterEnsureCreated = true;
                        tableExists = TableExists();
                    }
                    else
                    {
                        logger.LogWarning("No relational database creator was available to rebuild {TableName}.", tableName);
                    }
                }

                if (!tableExists)
                {
                    logger.LogError("EnsureCreated did not create the expected table {TableName}. Failing startup.", tableName);
                    throw new InvalidOperationException($"The expected table '{tableName}' was not created after migrations and EnsureCreated.");
                }

                logger.LogInformation("EnsureCreated successfully created {TableName}.", tableName);
            }
            else
            {
                logger.LogInformation("Confirmed that {TableName} exists after migrations.", tableName);
            }
        }
        finally
        {
            if ((connectionWasClosed || reopenAfterEnsureCreated) && connection.State == ConnectionState.Open)
            {
                connection.Close();
            }
        }
    }
}

static IEnumerable<string> ExtractCreateStatementsForTable(string createScript, string tableName)
{
    var statements = SplitSqlStatements(createScript);
    foreach (var statement in statements)
    {
        var trimmedStatement = statement.Trim();
        if (IsCreateTableForTable(trimmedStatement, tableName))
        {
            yield return EnsureIfNotExists(trimmedStatement, "CREATE TABLE") + ";";
        }
        else if (IsCreateIndexForTable(trimmedStatement, tableName))
        {
            var keyword = trimmedStatement.StartsWith("CREATE UNIQUE INDEX", StringComparison.OrdinalIgnoreCase)
                ? "CREATE UNIQUE INDEX"
                : "CREATE INDEX";

            yield return EnsureIfNotExists(trimmedStatement, keyword) + ";";
        }
    }
}

static IEnumerable<string> SplitSqlStatements(string script)
{
    var statements = new List<string>();
    var current = new StringBuilder();
    var inSingleQuote = false;
    var inDoubleQuote = false;

    for (var i = 0; i < script.Length; i++)
    {
        var c = script[i];

        if (c == '\'' && !inDoubleQuote)
        {
            current.Append(c);
            if (inSingleQuote && i + 1 < script.Length && script[i + 1] == '\'')
            {
                current.Append(script[i + 1]);
                i++;
            }
            else
            {
                inSingleQuote = !inSingleQuote;
            }

            continue;
        }

        if (c == '"' && !inSingleQuote)
        {
            current.Append(c);
            if (inDoubleQuote && i + 1 < script.Length && script[i + 1] == '"')
            {
                current.Append(script[i + 1]);
                i++;
            }
            else
            {
                inDoubleQuote = !inDoubleQuote;
            }

            continue;
        }

        if (c == ';' && !inSingleQuote && !inDoubleQuote)
        {
            var statement = current.ToString();
            if (!string.IsNullOrWhiteSpace(statement))
            {
                statements.Add(statement);
            }

            current.Clear();
            continue;
        }

        current.Append(c);
    }

    if (current.Length > 0)
    {
        var statement = current.ToString();
        if (!string.IsNullOrWhiteSpace(statement))
        {
            statements.Add(statement);
        }
    }

    return statements;
}

static bool IsCreateTableForTable(string statement, string tableName)
{
    var match = Regex.Match(statement, "^CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?<name>\"[^\"]+\"|\\[[^\\]]+\\]|`[^`]+`|\\S+)", RegexOptions.IgnoreCase);
    if (!match.Success)
    {
        return false;
    }

    return IdentifierEquals(match.Groups["name"].Value, tableName);
}

static bool IsCreateIndexForTable(string statement, string tableName)
{
    var match = Regex.Match(statement, "^CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?<name>\"[^\"]+\"|\\[[^\\]]+\\]|`[^`]+`|\\S+)\\s+ON\\s+(?<table>\"[^\"]+\"|\\[[^\\]]+\\]|`[^`]+`|\\S+)", RegexOptions.IgnoreCase);
    if (!match.Success)
    {
        return false;
    }

    return IdentifierEquals(match.Groups["table"].Value, tableName);
}

static bool IdentifierEquals(string identifier, string tableName)
{
    var unwrapped = identifier.Trim();
    if (unwrapped.Length >= 2)
    {
        if ((unwrapped.StartsWith("\"") && unwrapped.EndsWith("\"")) ||
            (unwrapped.StartsWith("[") && unwrapped.EndsWith("]")) ||
            (unwrapped.StartsWith("`") && unwrapped.EndsWith("`")))
        {
            unwrapped = unwrapped.Substring(1, unwrapped.Length - 2);
        }
    }

    return string.Equals(unwrapped, tableName, StringComparison.OrdinalIgnoreCase);
}

static string EnsureIfNotExists(string statement, string keyword)
{
    var keywordIndex = statement.IndexOf(keyword, StringComparison.OrdinalIgnoreCase);
    if (keywordIndex < 0)
    {
        return statement;
    }

    var afterKeywordIndex = keywordIndex + keyword.Length;
    var remaining = statement.Substring(afterKeywordIndex);
    if (remaining.TrimStart().StartsWith("IF NOT EXISTS", StringComparison.OrdinalIgnoreCase))
    {
        return statement;
    }

    return statement.Insert(afterKeywordIndex, " IF NOT EXISTS");
}

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}

app.UseHttpsRedirection();

app.UseAuthentication();
app.UseAuthorization();

app.UseAntiforgery();

app.MapStaticAssets();
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();
app.MapHub<PuzzleHub>("/puzzlehub");

app.MapPost("/register", async (UserManager<IdentityUser> userManager, SignInManager<IdentityUser> signInManager, RegisterRequest? req, ILogger<Program> logger) =>
{
    if (req is null ||
        string.IsNullOrWhiteSpace(req.Username) ||
        string.IsNullOrWhiteSpace(req.Password) ||
        string.IsNullOrWhiteSpace(req.ConfirmPassword))
    {
        logger.LogWarning("Registration rejected due to missing required fields.");
        return Results.BadRequest(new { message = "Username and password are required." });
    }

    if (req.Password != req.ConfirmPassword)
    {
        return Results.BadRequest(new { message = "Passwords do not match" });
    }

    var user = new IdentityUser(req.Username);
    var result = await userManager.CreateAsync(user, req.Password);
    if (!result.Succeeded)
    {
        var message = string.Join(" ", result.Errors.Select(e => e.Description));
        return Results.BadRequest(new { message });
    }

    await signInManager.SignInAsync(user, isPersistent: false);
    return Results.Ok(new { message = "Account created successfully" });
});

app.MapPost("/login", async (SignInManager<IdentityUser> signInManager, LoginRequest req, ILogger<Program> logger) =>
{
    var result = await signInManager.PasswordSignInAsync(req.Username, req.Password, isPersistent: false, lockoutOnFailure: false);
    if (result.Succeeded)
    {
        return Results.Ok();
    }

    if (result.RequiresTwoFactor)
    {
        logger.LogWarning("Login for user {Username} requires two-factor authentication.", req.Username);
        return Results.BadRequest(new { message = "Two-factor authentication required." });
    }

    if (result.IsLockedOut)
    {
        logger.LogWarning("Login for user {Username} is locked out.", req.Username);
        return Results.BadRequest(new { message = "Account is locked out." });
    }

    if (result.IsNotAllowed)
    {
        logger.LogWarning("Login for user {Username} is not allowed.", req.Username);
        return Results.BadRequest(new { message = "Login is not allowed." });
    }

    return Results.BadRequest(new { message = "Invalid login attempt" });
});

app.MapPost("/logout", async (SignInManager<IdentityUser> signInManager) =>
{
    await signInManager.SignOutAsync();
    return Results.Ok();
});

app.MapGet("/user", (ClaimsPrincipal user) =>
    user.Identity?.IsAuthenticated == true
        ? Results.Ok(user.Identity.Name)
        : Results.Unauthorized());

app.Run();

public record RegisterRequest(string Username, string Password, string ConfirmPassword);
public record LoginRequest(string Username, string Password);
