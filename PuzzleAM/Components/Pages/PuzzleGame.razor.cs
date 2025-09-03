using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Forms;

namespace PuzzleAM.Components.Pages;

public partial class PuzzleGame : ComponentBase
{
    private string? imageDataUrl;

    private async Task OnInputFileChange(InputFileChangeEventArgs e)
    {
        var file = e.File;
        var buffer = new byte[file.Size];
        await file.OpenReadStream(10 * 1024 * 1024).ReadAsync(buffer); // limit 10 MB
        imageDataUrl = $"data:{file.ContentType};base64,{Convert.ToBase64String(buffer)}";
    }
}

