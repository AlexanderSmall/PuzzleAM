using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Forms;
using Microsoft.JSInterop;

namespace PuzzleAM.Components.Pages;

public partial class PuzzleGame : ComponentBase
{
    private string? imageDataUrl;
    [Inject] private IJSRuntime JS { get; set; } = default!;

    private async Task OnInputFileChange(InputFileChangeEventArgs e)
    {
        var file = e.File;
        await using var stream = file.OpenReadStream(10 * 1024 * 1024);
        using var ms = new MemoryStream();
        await stream.CopyToAsync(ms);        // ensures the full file is read
        imageDataUrl = $"data:{file.ContentType};base64,{Convert.ToBase64String(ms.ToArray())}";
        await JS.InvokeVoidAsync("createPuzzle", imageDataUrl, "puzzleContainer");
    }
}

