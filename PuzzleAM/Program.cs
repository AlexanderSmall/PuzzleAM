using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PuzzleAM;
using PuzzleAM.Components;
using PuzzleAM.Hubs;
using PuzzleAM.ViewServices;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();

builder.Services.AddScoped<ModalService>();
builder.Services.AddSignalR(o =>
    o.MaximumReceiveMessageSize = 10 * 1024 * 1024);

var connection = builder.Configuration.GetConnectionString("DefaultConnection") ?? "Data Source=app.db";
builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseSqlite(connection));
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
    db.Database.EnsureCreated();
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

app.Run();

public record RegisterRequest(string Username, string Password, string ConfirmPassword);
public record LoginRequest(string Username, string Password);
