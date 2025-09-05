using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Forms;
using Microsoft.Extensions.Logging;
using Microsoft.JSInterop;
using PuzzleAM.Model;

namespace PuzzleAM.Components.Pages;

public partial class PuzzleGame : ComponentBase
{
    private string? imageDataUrl;
    [Inject] private IJSRuntime JS { get; set; } = default!;
    [Inject] private ILogger<PuzzleGame> Logger { get; set; } = default!;
    private string? roomCode;
    private string? joinCode;
    private int selectedPieces = 100;
    private static readonly int[] PieceOptions = { 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000 };
    private string selectedBackground = "#EFECE6";
    private bool scriptLoaded;

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
        if (string.IsNullOrEmpty(imageDataUrl)) return;
        roomCode = await JS.InvokeAsync<string?>("createRoom", imageDataUrl, selectedPieces);
    }

    private async Task JoinRoom()
    {
        if (string.IsNullOrWhiteSpace(joinCode)) return;
        var state = await JS.InvokeAsync<PuzzleState?>("joinRoom", joinCode);
        if (state is not null && !string.IsNullOrEmpty(state.ImageDataUrl))
        {
            imageDataUrl = state.ImageDataUrl;
            selectedPieces = state.PieceCount;
            await JS.InvokeVoidAsync("createPuzzle", imageDataUrl, "puzzleContainer", selectedPieces);
            roomCode = joinCode;
        }
    }

}

