using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using Microsoft.AspNetCore.SignalR;
using PuzzleAM.Model;
using SixLabors.ImageSharp;

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

    public async Task<string> CreateRoom(string imageDataUrl = "", int pieceCount = 0)
    {
        string code;
        do
        {
            code = GenerateRoomCode();
        } while (!Rooms.TryAdd(code, new PuzzleState { ImageDataUrl = imageDataUrl, PieceCount = pieceCount }));

        await Groups.AddToGroupAsync(Context.ConnectionId, code);
        return code;
    }

    public async Task SetPuzzle(string roomCode, string imageDataUrl, int pieceCount)
    {
        if (Rooms.TryGetValue(roomCode, out var state))
        {
            state.ImageDataUrl = imageDataUrl;
            state.PieceCount = pieceCount;
            state.Pieces.Clear();

            double aspect = 1;
            try
            {
                var commaIndex = imageDataUrl.IndexOf(',');
                var base64 = commaIndex >= 0 ? imageDataUrl[(commaIndex + 1)..] : imageDataUrl;
                var imageBytes = Convert.FromBase64String(base64);
                using var image = Image.Load(imageBytes);
                aspect = (double)image.Width / image.Height;
            }
            catch
            {
                aspect = 1;
            }

            int bestRows = 1;
            int bestCols = pieceCount;
            double bestDiff = double.MaxValue;
            for (int r = 1; r <= Math.Sqrt(pieceCount); r++)
            {
                if (pieceCount % r == 0)
                {
                    int c = pieceCount / r;
                    bool orientationOk = aspect >= 1 ? c >= r : r >= c;
                    double diff = Math.Abs((double)c / r - aspect);
                    if (orientationOk && diff < bestDiff)
                    {
                        bestDiff = diff;
                        bestRows = r;
                        bestCols = c;
                    }
                }
            }

            if (bestDiff == double.MaxValue)
            {
                for (int r = 1; r <= Math.Sqrt(pieceCount); r++)
                {
                    if (pieceCount % r == 0)
                    {
                        int c = pieceCount / r;
                        double diff = Math.Abs((double)c / r - aspect);
                        if (diff < bestDiff)
                        {
                            bestDiff = diff;
                            bestRows = r;
                            bestCols = c;
                        }
                    }
                }
            }

            state.Rows = bestRows;
            state.Columns = bestCols;
            state.BoardWidth = 1f;
            state.BoardHeight = 1f;

            var pieceWidth = 1.0 / state.Columns;
            var pieceHeight = 1.0 / state.Rows;
            var buffer = Math.Max(pieceWidth, pieceHeight);

            var placedRects = new List<(double x, double y, double w, double h)>();
            for (var id = 0; id < pieceCount; id++)
            {
                double startX, startY;
                var attempts = 0;
                do
                {
                    attempts++;
                    var side = Random.Next(4);
                    if (side == 0)
                    {
                        // top
                        startX = Random.NextDouble() * (state.BoardWidth - pieceWidth);
                        startY = -pieceHeight - Random.NextDouble() * buffer;
                    }
                    else if (side == 1)
                    {
                        // bottom
                        startX = Random.NextDouble() * (state.BoardWidth - pieceWidth);
                        startY = state.BoardHeight + Random.NextDouble() * buffer;
                    }
                    else if (side == 2)
                    {
                        // left
                        startX = -pieceWidth - Random.NextDouble() * buffer;
                        startY = Random.NextDouble() * (state.BoardHeight - pieceHeight);
                    }
                    else
                    {
                        // right
                        startX = state.BoardWidth + Random.NextDouble() * buffer;
                        startY = Random.NextDouble() * (state.BoardHeight - pieceHeight);
                    }
                } while (placedRects.Any(r => startX < r.x + r.w && startX + pieceWidth > r.x && startY < r.y + r.h && startY + pieceHeight > r.y) && attempts < 1000);

                placedRects.Add((startX, startY, pieceWidth, pieceHeight));
                state.Pieces[id] = new PiecePosition(id, (float)startX, (float)startY, id);
            }

            await Clients.Group(roomCode).SendAsync("BoardState", new
            {
                imageDataUrl = state.ImageDataUrl,
                pieceCount = state.PieceCount,
                boardWidth = state.BoardWidth,
                boardHeight = state.BoardHeight,
                rows = state.Rows,
                columns = state.Columns,
                pieces = state.Pieces.Values
            });
        }
    }

    public async Task<PuzzleState?> JoinRoom(string roomCode)
    {
        if (Rooms.TryGetValue(roomCode, out var state))
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, roomCode);
            await Clients.Caller.SendAsync("BoardState", new
            {
                imageDataUrl = state.ImageDataUrl,
                pieceCount = state.PieceCount,
                boardWidth = state.BoardWidth,
                boardHeight = state.BoardHeight,
                rows = state.Rows,
                columns = state.Columns,
                pieces = state.Pieces.Values
            });
            return state;
        }

        return null;
    }

    public async Task LeaveRoom(string roomCode)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomCode);
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
            await Clients.Group(roomCode).SendAsync("PieceMoved", piece);
        }
    }
}
