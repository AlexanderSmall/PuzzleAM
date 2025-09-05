using System.Collections.Concurrent;
using System.Linq;
using Microsoft.AspNetCore.SignalR;
using PuzzleAM.Model;

namespace PuzzleAM.Hubs;

public class PuzzleHub : Hub
{
    // Track the state for each room using the generated room code as the key
    private static readonly ConcurrentDictionary<string, PuzzleState> Rooms = new();

    private static readonly Random Random = new();

    private static string GenerateRoomCode()
    {
        const string chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        return new string(Enumerable.Range(0, 6).Select(_ => chars[Random.Next(chars.Length)]).ToArray());
    }

    public async Task<string> CreateRoom(string imageDataUrl, int pieceCount)
    {
        string code;
        do
        {
            code = GenerateRoomCode();
        } while (!Rooms.TryAdd(code, new PuzzleState { ImageDataUrl = imageDataUrl, PieceCount = pieceCount }));

        await Groups.AddToGroupAsync(Context.ConnectionId, code);
        return code;
    }

    public async Task<PuzzleState?> JoinRoom(string roomCode)
    {
        if (Rooms.TryGetValue(roomCode, out var state))
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, roomCode);
            return state;
        }

        return null;
    }

    /// <summary>
    /// Persists the new position of a piece and broadcasts it to clients in the
    /// same room.
    /// </summary>
    public async Task MovePiece(string roomCode, PiecePosition piece)
    {
        if (Rooms.TryGetValue(roomCode, out var state))
        {
            state.Pieces[piece.Id] = piece;
            await Clients.OthersInGroup(roomCode).SendAsync("PieceMoved", piece);
        }
    }
}
