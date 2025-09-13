using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Forms;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.Extensions.Logging;
using Microsoft.JSInterop;
using PuzzleAM;
using PuzzleAM.Model;
using System.Diagnostics;
using System.Security.Claims;
using System.Threading;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.Processing;

namespace PuzzleAM.Components.Pages;

public partial class PuzzleGame : ComponentBase, IAsyncDisposable
{
    private string? imageDataUrl;
    private byte[]? imageBytes;
    private string? imageContentType;
    [Inject] private IJSRuntime JS { get; set; } = default!;
    [Inject] private ILogger<PuzzleGame> Logger { get; set; } = default!;
    [Inject] private NavigationManager Nav { get; set; } = default!;
    [Inject] private AuthenticationStateProvider AuthStateProvider { get; set; } = default!;
    [Inject] private ApplicationDbContext Db { get; set; } = default!;
    [Parameter] public string? RoomCode { get; set; }
    private int selectedPieces = 112;
    private static readonly int[] PieceOptions = { 8, 10, 12, 18, 21, 24, 32, 40, 50, 55, 60, 78, 84, 90, 105, 112, 119, 136, 144, 152, 171, 180, 189, 210, 220, 230, 253, 264, 275, 312 };
    private string selectedBackground = "#EFECE6";
    private bool scriptLoaded;
    private bool joined;
    private bool settingsVisible = false;
    private bool userListVisible = false;
    private List<string> users = new();
    private DotNetObjectReference<PuzzleGame>? objRef;
    private readonly Stopwatch stopwatch = new();
    private Timer? timer;
    private TimeSpan elapsed = TimeSpan.Zero;
    private bool completionRecorded;
    private bool puzzleStarted;

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (firstRender)
        {
            try
            {
                var width = await JS.InvokeAsync<int>("eval", "window.innerWidth");
                selectedPieces = width < 768 ? 36 : 112;
                if (width >= 992)
                {
                    settingsVisible = true;
                    userListVisible = true;
                }
                StateHasChanged();

                await JS.InvokeVoidAsync("setBackgroundColor", selectedBackground);
                objRef = DotNetObjectReference.Create(this);
                await JS.InvokeVoidAsync("registerUserListHandler", objRef);
                await JS.InvokeVoidAsync("registerPuzzleEventHandler", objRef);
                scriptLoaded = true;

                if (!joined && !string.IsNullOrEmpty(RoomCode))
                {
                    var state = await JS.InvokeAsync<PuzzleState?>("joinRoom", RoomCode);
                    if (state is not null)
                    {
                        if (!string.IsNullOrEmpty(state.ImageDataUrl))
                        {
                            imageDataUrl = state.ImageDataUrl;
                            selectedPieces = state.PieceCount;
                        }
                        joined = true;
                    }
                }
            }
            catch (Exception ex)
            {
                Logger.LogError(ex, "Error initializing puzzle");
            }
        }
    }

    private async Task OnBackgroundChange()
    {
        if (scriptLoaded)
        {
            try
            {
                await JS.InvokeVoidAsync("setBackgroundColor", selectedBackground);
            }
            catch (Exception ex)
            {
                Logger.LogError(ex, "Error applying background color");
            }
        }
    }

    private async Task OnInputFileChange(InputFileChangeEventArgs e)
    {
        const int maxDimension = 1024;
        var file = e.File;
        await using var stream = file.OpenReadStream(10 * 1024 * 1024);
        using var image = await Image.LoadAsync(stream);

        if (image.Width > maxDimension || image.Height > maxDimension)
        {
            var ratio = Math.Min((double)maxDimension / image.Width, (double)maxDimension / image.Height);
            var width = (int)(image.Width * ratio);
            var height = (int)(image.Height * ratio);
            image.Mutate(x => x.Resize(width, height));
        }

        using var ms = new MemoryStream();
        var contentType = file.ContentType == "image/png" ? "image/png" : "image/jpeg";
        IImageEncoder encoder = contentType == "image/png" ? new PngEncoder() : new JpegEncoder();

        await image.SaveAsync(ms, encoder);
        imageBytes = ms.ToArray();
        imageContentType = contentType;
        imageDataUrl = $"data:{contentType};base64,{Convert.ToBase64String(imageBytes)}";

        stopwatch.Reset();
        elapsed = TimeSpan.Zero;
        timer?.Dispose();
        puzzleStarted = false;
        if (!string.IsNullOrEmpty(RoomCode))
        {
            await JS.InvokeVoidAsync("setPuzzle", RoomCode, imageDataUrl, selectedPieces);
        }
    }

    private async Task CopyRoomCode()
    {
        if (!string.IsNullOrEmpty(RoomCode))
        {
            try
            {
                await JS.InvokeVoidAsync("navigator.clipboard.writeText", RoomCode);
            }
            catch (Exception ex)
            {
                Logger.LogError(ex, "Error copying room code");
            }
        }
    }

    private async Task LeaveRoom()
    {
        if (joined)
        {
            try
            {
                await JS.InvokeVoidAsync("leaveRoom");
            }
            catch (Exception ex)
            {
                Logger.LogError(ex, "Error leaving room");
            }

            joined = false;
            Nav.NavigateTo("/");
        }
    }

    private void ToggleSettings()
    {
        settingsVisible = !settingsVisible;
    }

    private void ToggleUserList()
    {
        userListVisible = !userListVisible;
    }

    private async Task ToggleFullScreen()
    {
        if (scriptLoaded)
        {
            try
            {
                await JS.InvokeVoidAsync("toggleFullScreen");
            }
            catch (Exception ex)
            {
                Logger.LogError(ex, "Error toggling full screen");
            }
        }
    }

    [JSInvokable]
    public Task ReceiveUserList(string[] names)
    {
        users = names.ToList();
        StateHasChanged();
        return Task.CompletedTask;
    }

    [JSInvokable]
    public Task PuzzleLoaded()
    {
        if (puzzleStarted)
        {
            return Task.CompletedTask;
        }
        completionRecorded = false;
        stopwatch.Restart();
        elapsed = TimeSpan.Zero;
        timer?.Dispose();
        timer = new Timer(_ =>
        {
            elapsed = stopwatch.Elapsed;
            InvokeAsync(StateHasChanged);
        }, null, 0, 1000);
        puzzleStarted = true;
        return Task.CompletedTask;
    }

    [JSInvokable]
    public async Task PuzzleCompleted()
    {
        if (completionRecorded)
        {
            return;
        }
        completionRecorded = true;
        timer?.Dispose();
        if (stopwatch.IsRunning)
        {
            stopwatch.Stop();
            elapsed = stopwatch.Elapsed;
            StateHasChanged();
        }

        var authState = await AuthStateProvider.GetAuthenticationStateAsync();
        var user = authState.User;
        if (user.Identity?.IsAuthenticated == true && imageBytes is not null && !string.IsNullOrEmpty(imageContentType))
        {
            var userId = user.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (userId is not null)
            {
                var puzzle = new CompletedPuzzle
                {
                    UserId = userId,
                    UserName = user.Identity?.Name,
                    ImageData = imageBytes,
                    ContentType = imageContentType,
                    PieceCount = selectedPieces,
                    TimeToComplete = elapsed
                };
                Db.CompletedPuzzles.Add(puzzle);
                await Db.SaveChangesAsync();
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        timer?.Dispose();
        objRef?.Dispose();
        await Task.CompletedTask;
    }
}
