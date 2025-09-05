using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Forms;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.JSInterop;
using Microsoft.Extensions.Logging;

namespace PuzzleAM.Components.Pages;

public partial class PuzzleGame : ComponentBase, IAsyncDisposable
{
    private string? imageDataUrl;
    [Inject] private IJSRuntime JS { get; set; } = default!;
    [Inject] private NavigationManager Navigation { get; set; } = default!;
    [Inject] private ILogger<PuzzleGame> Logger { get; set; } = default!;
    private HubConnection? hubConnection;
    private string? roomCode;
    private string? joinCode;
    private string connectionStatus = "Disconnected";
    private int selectedPieces = 100;
    private static readonly int[] PieceOptions = { 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000 };
    private string selectedBackground = "#EFECE6";
    private bool scriptLoaded;

    private bool IsConnected => hubConnection?.State == HubConnectionState.Connected;

    protected override async Task OnInitializedAsync()
    {
        hubConnection = new HubConnectionBuilder()
            .WithUrl(Navigation.ToAbsoluteUri("/puzzlehub"))
            .WithAutomaticReconnect()
            .Build();

        hubConnection.Reconnecting += error =>
        {
            connectionStatus = "Reconnecting...";
            InvokeAsync(StateHasChanged);
            return Task.CompletedTask;
        };

        hubConnection.Reconnected += connectionId =>
        {
            connectionStatus = "Connected";
            InvokeAsync(StateHasChanged);
            return Task.CompletedTask;
        };

        hubConnection.Closed += error =>
        {
            connectionStatus = "Disconnected";
            InvokeAsync(StateHasChanged);
            return Task.CompletedTask;
        };

        await hubConnection.StartAsync();
        connectionStatus = "Connected";
    }

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (firstRender)
        {
            try
            {
                await JS.InvokeVoidAsync("setBackgroundColor", selectedBackground);
                scriptLoaded = true;
            }
            catch (Exception ex)
            {
                connectionStatus = "Background color error";
                Logger.LogError(ex, "Error applying background color");
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
                connectionStatus = "Background color error";
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
        await JS.InvokeVoidAsync("createPuzzle", imageDataUrl, "puzzleContainer", selectedPieces);
    }

    private async Task CreateRoom()
    {
        if (hubConnection is null || string.IsNullOrEmpty(imageDataUrl)) return;
        roomCode = await hubConnection.InvokeAsync<string>("CreateRoom", imageDataUrl, selectedPieces);
        if (!string.IsNullOrEmpty(roomCode))
        {
            await JS.InvokeVoidAsync("setRoomCode", roomCode);
        }
    }

    private async Task JoinRoom()
    {
        if (hubConnection is null || string.IsNullOrWhiteSpace(joinCode)) return;
        var state = await hubConnection.InvokeAsync<PuzzleState?>("JoinRoom", joinCode);
        if (state is not null && !string.IsNullOrEmpty(state.ImageDataUrl))
        {
            imageDataUrl = state.ImageDataUrl;
            selectedPieces = state.PieceCount;
            await JS.InvokeVoidAsync("createPuzzle", imageDataUrl, "puzzleContainer", selectedPieces);
            roomCode = joinCode;
            await JS.InvokeVoidAsync("setRoomCode", roomCode);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (hubConnection is not null)
        {
            await hubConnection.DisposeAsync();
        }
    }

    private record PuzzleState(string ImageDataUrl, int PieceCount);
}

