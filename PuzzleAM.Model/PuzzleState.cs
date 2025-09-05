namespace PuzzleAM.Model;

using System.Collections.Concurrent;

/// <summary>
/// Represents the position of a puzzle piece on the board.
/// </summary>
public record PiecePosition(int Id, float Left, float Top, int? GroupId);

/// <summary>
/// Maintains the current state of a puzzle session.
/// </summary>
public class PuzzleState
{
    public string ImageDataUrl { get; set; } = string.Empty;
    public int PieceCount { get; set; }
    public ConcurrentDictionary<int, PiecePosition> Pieces { get; } = new();
}
