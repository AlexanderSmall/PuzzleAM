using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;

namespace PuzzleAM.Hubs;

/// <summary>
/// Represents the position of a puzzle piece on the board.
/// </summary>
public record PiecePosition(int Id, float Left, float Top, int? GroupId);

/// <summary>
/// Maintains the current state of a puzzle session.
/// </summary>
public class PuzzleState
{
    public ConcurrentDictionary<int, PiecePosition> Pieces { get; } = new();
}

public class PuzzleHub : Hub
{
    // For the purposes of the sample a single global state is sufficient.
    private static readonly PuzzleState State = new();

    /// <summary>
    /// Persists the new position of a piece and broadcasts it to the
    /// remaining connected clients.
    /// </summary>
    public async Task MovePiece(PiecePosition piece)
    {
        State.Pieces[piece.Id] = piece;
        await Clients.Others.SendAsync("PieceMoved", piece);
    }
}
