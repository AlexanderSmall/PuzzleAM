using System;

namespace PuzzleAM;

public class CompletedPuzzle
{
    public int Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public string? UserName { get; set; }
    public string ImageDataUrl { get; set; } = string.Empty;
    public int PieceCount { get; set; }
    public TimeSpan TimeToComplete { get; set; }
}
