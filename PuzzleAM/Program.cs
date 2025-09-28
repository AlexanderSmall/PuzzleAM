using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PuzzleAM;
using PuzzleAM.Components;
using PuzzleAM.Hubs;
using PuzzleAM.ViewServices;
using System.Net.Http;
using System.Security.Claims;
using System.IO;

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

builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseSqlite(sqliteBuilder.ConnectionString));
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
    db.Database.Migrate();
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

app.MapPost("/register", async (UserManager<IdentityUser> userManager, SignInManager<IdentityUser> signInManager, RegisterRequest req) =>
{
    if (req.Password != req.ConfirmPassword)
    {
        return Results.BadRequest("Passwords do not match");
    }
    var user = new IdentityUser(req.Username);
    var result = await userManager.CreateAsync(user, req.Password);
    if (!result.Succeeded)
    {
        return Results.BadRequest(result.Errors);
    }
    await signInManager.SignInAsync(user, isPersistent: false);
    return Results.Ok();
});

app.MapPost("/login", async (SignInManager<IdentityUser> signInManager, LoginRequest req) =>
{
    var result = await signInManager.PasswordSignInAsync(req.Username, req.Password, isPersistent: false, lockoutOnFailure: false);
    return result.Succeeded ? Results.Ok() : Results.BadRequest("Invalid login attempt");
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
