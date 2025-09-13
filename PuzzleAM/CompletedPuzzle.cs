using System;
using System.ComponentModel.DataAnnotations.Schema;

namespace PuzzleAM;

public class CompletedPuzzle
{
    public int Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public string? UserName { get; set; }
    public byte[] ImageData { get; set; } = Array.Empty<byte>();
    public string ContentType { get; set; } = string.Empty;
    public int PieceCount { get; set; }
    public TimeSpan TimeToComplete { get; set; }

    [NotMapped]
    public string ImageDataUrl => $"data:{ContentType};base64,{Convert.ToBase64String(ImageData)}";
}
