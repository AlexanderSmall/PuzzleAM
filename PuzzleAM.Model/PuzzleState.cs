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
    // Dimensions of the puzzle board expressed in arbitrary units. Clients
    // will typically treat the board width and height as 1.0 and scale to the
    // available display area while piece coordinates are stored as percentages
    // relative to these dimensions.
    public float BoardWidth { get; set; } = 1f;
    public float BoardHeight { get; set; } = 1f;

    // Number of rows and columns the puzzle is divided into. This is required
    // when reconstructing the puzzle layout on clients so that the piece sizes
    // and shapes can be calculated consistently.
    public int Rows { get; set; }
    public int Columns { get; set; }

    public ConcurrentDictionary<int, PiecePosition> Pieces { get; } = new();
    public ConcurrentDictionary<string, string> Users { get; } = new();
    public ConcurrentDictionary<int, string> PieceLocks { get; } = new();

    public object SyncRoot { get; } = new();
}
