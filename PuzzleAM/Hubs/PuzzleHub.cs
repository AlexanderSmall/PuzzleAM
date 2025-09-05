using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;

namespace PuzzleAM.Hubs;

public class PuzzleState
{
    public ConcurrentDictionary<string, (int X, int Y)> Pieces { get; } = new();
    public ConcurrentDictionary<string, byte> Participants { get; } = new();
}

public class PuzzleHub : Hub
{
    // Maps room codes to their puzzle state. Persist to Redis or a database for scalability if needed.
    private static readonly ConcurrentDictionary<string, PuzzleState> Rooms = new();

    public string CreateRoom()
    {
        var code = Guid.NewGuid().ToString("N").Substring(0, 6).ToUpperInvariant();
        Rooms[code] = new PuzzleState();
        return code;
    }

    public async Task JoinRoom(string roomCode)
    {
        if (Rooms.TryGetValue(roomCode, out var state))
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, roomCode);
            state.Participants[Context.ConnectionId] = 0;
            await Clients.Caller.SendAsync("BoardState", state.Pieces);
        }
    }

    public async Task MovePiece(string roomCode, string pieceId, int x, int y)
    {
        if (Rooms.TryGetValue(roomCode, out var state))
        {
            state.Pieces[pieceId] = (x, y);
            await Clients.Group(roomCode).SendAsync("PieceMoved", pieceId, x, y);
        }
    }
}
