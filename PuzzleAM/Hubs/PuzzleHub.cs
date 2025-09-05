using Microsoft.AspNetCore.SignalR;
using PuzzleAM.Model;

namespace PuzzleAM.Hubs;

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
