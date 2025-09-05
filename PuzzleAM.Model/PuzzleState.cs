using System.Collections.Concurrent;

namespace PuzzleAM.Model;

/// <summary>
/// Represents the position of a puzzle piece on the board.
/// </summary>
public record PiecePosition(int Id, float Left, float Top, int? GroupId);

/// <summary>
/// Maintains the current state of a puzzle session.
/// </summary>
public class PuzzleState
{
    /// <summary>
    /// Gets or sets the URL containing the puzzle image data.
    /// </summary>
    public string? ImageDataUrl { get; set; }

    /// <summary>
    /// Gets or sets the number of pieces the puzzle contains.
    /// </summary>
    public int PieceCount { get; set; }

    /// <summary>
    /// Tracks the positions of puzzle pieces by their identifier.
    /// </summary>
    public ConcurrentDictionary<int, PiecePosition> Pieces { get; } = new();
}

