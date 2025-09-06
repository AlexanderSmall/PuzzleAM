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

            // Use a margin around the board where pieces may be scattered. If the
            // region becomes too crowded we expand the margin to ensure pieces do
            // not overlap and are always placed outside the board area.
            var marginX = Math.Max(pieceWidth, pieceHeight);
            var marginY = marginX;

            var placedRects = new List<(double x, double y, double w, double h)>();
            for (var id = 0; id < pieceCount; id++)
            {
                double startX, startY;
                var attempts = 0;
                while (true)
                {
                    attempts++;

                    var rangeX = state.BoardWidth + 2 * marginX - pieceWidth;
                    var rangeY = state.BoardHeight + 2 * marginY - pieceHeight;
                    startX = Random.NextDouble() * rangeX - marginX;
                    startY = Random.NextDouble() * rangeY - marginY;

                    var overlapsBoard = startX < state.BoardWidth && startX + pieceWidth > 0 &&
                                        startY < state.BoardHeight && startY + pieceHeight > 0;

                    var overlapsPiece = placedRects.Any(r => startX < r.x + r.w && startX + pieceWidth > r.x &&
                                                             startY < r.y + r.h && startY + pieceHeight > r.y);

                    if (!overlapsBoard && !overlapsPiece)
                    {
                        break;
                    }

                    if (attempts >= 1000)
                    {
                        // No available space; expand the scatter region and try again.
                        marginX *= 1.5;
                        marginY *= 1.5;
                        attempts = 0;
                    }
                }

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
