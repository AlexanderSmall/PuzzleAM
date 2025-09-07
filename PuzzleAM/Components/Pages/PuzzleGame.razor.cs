using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Forms;
using Microsoft.Extensions.Logging;
using Microsoft.JSInterop;
using PuzzleAM.Model;

namespace PuzzleAM.Components.Pages;

public partial class PuzzleGame : ComponentBase, IAsyncDisposable
{
    private string? imageDataUrl;
    [Inject] private IJSRuntime JS { get; set; } = default!;
    [Inject] private ILogger<PuzzleGame> Logger { get; set; } = default!;
    [Inject] private NavigationManager Nav { get; set; } = default!;
    [Parameter] public string? RoomCode { get; set; }
    private int selectedPieces = 100;
    private static readonly int[] PieceOptions = { 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000 };
    private string selectedBackground = "#EFECE6";
    private bool scriptLoaded;
    private bool joined;
    private bool settingsVisible = true;
    private List<string> users = new();
    private DotNetObjectReference<PuzzleGame>? objRef;

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (firstRender)
        {
            try
            {
                await JS.InvokeVoidAsync("setBackgroundColor", selectedBackground);
                objRef = DotNetObjectReference.Create(this);
                await JS.InvokeVoidAsync("registerUserListHandler", objRef);
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
        var file = e.File;
        await using var stream = file.OpenReadStream(10 * 1024 * 1024);
        using var ms = new MemoryStream();
        await stream.CopyToAsync(ms);        // ensures the full file is read
        imageDataUrl = $"data:{file.ContentType};base64,{Convert.ToBase64String(ms.ToArray())}";
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

    [JSInvokable]
    public Task ReceiveUserList(string[] names)
    {
        users = names.ToList();
        StateHasChanged();
        return Task.CompletedTask;
    }

    public async ValueTask DisposeAsync()
    {
        objRef?.Dispose();
        await Task.CompletedTask;
    }
}
