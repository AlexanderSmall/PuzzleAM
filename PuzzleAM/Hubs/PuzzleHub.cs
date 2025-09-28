using System.Buffers;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
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

    private static string GetUserName(HubCallerContext context)
    {
        if (context.User?.Identity?.IsAuthenticated == true && !string.IsNullOrEmpty(context.User.Identity.Name))
        {
            return context.User.Identity.Name!;
        }
        return $"Guest{Random.Next(1000, 9999)}";
    }

    public async Task<string> CreateRoom(string imageDataUrl = "", int pieceCount = 0)
    {
        string code;
        do
        {
            code = GenerateRoomCode();
        } while (!Rooms.TryAdd(code, new PuzzleState { ImageDataUrl = imageDataUrl, PieceCount = pieceCount }));

        await Groups.AddToGroupAsync(Context.ConnectionId, code);
        var userName = GetUserName(Context);
        Rooms[code].Users[Context.ConnectionId] = userName;
        await Clients.Group(code).SendAsync("UserList", Rooms[code].Users.Values);
        return code;
    }

    public async Task SetPuzzle(string roomCode, string imageDataUrl, int pieceCount)
    {
        if (Rooms.TryGetValue(roomCode, out var state))
        {
            state.ImageDataUrl = imageDataUrl;
            state.PieceCount = pieceCount;
            state.Pieces.Clear();
            state.PieceLocks.Clear();

            double aspect = 1;
            if (!string.IsNullOrEmpty(imageDataUrl))
            {
                try
                {
                    ReadOnlySpan<char> base64Span = imageDataUrl.AsSpan();
                    var commaIndex = base64Span.IndexOf(',');
                    if (commaIndex >= 0)
                    {
                        base64Span = base64Span[(commaIndex + 1)..];
                    }

                    var bufferLength = (base64Span.Length * 3) / 4 + 4;
                    var rentedBuffer = ArrayPool<byte>.Shared.Rent(bufferLength);
                    try
                    {
                        if (Convert.TryFromBase64Chars(base64Span, rentedBuffer, out var bytesWritten))
                        {
                            using var stream = new MemoryStream(rentedBuffer, 0, bytesWritten, writable: false, publiclyVisible: true);
                            var info = Image.Identify(stream);
                            if (info is not null && info.Height > 0)
                            {
                                aspect = (double)info.Width / info.Height;
                            }
                        }
                    }
                    finally
                    {
                        ArrayPool<byte>.Shared.Return(rentedBuffer);
                    }
                }
                catch
                {
                    aspect = 1;
                }
            }

            var safeAspect = aspect > 0 ? aspect : 1;
            int bestRows = 1;
            int bestCols = Math.Max(1, pieceCount);
            double bestPieceDiff = double.MaxValue;
            double bestBoardDiff = double.MaxValue;

            void EvaluateCandidate(int rows, int cols)
            {
                if (rows <= 0 || cols <= 0)
                {
                    return;
                }

                var pieceAspect = safeAspect * rows / cols;
                var pieceDiff = Math.Abs(pieceAspect - 1.0);
                var boardDiff = Math.Abs((double)cols / rows - safeAspect);

                bool isBetter = pieceDiff < bestPieceDiff
                    || (Math.Abs(pieceDiff - bestPieceDiff) < 1e-9 && boardDiff < bestBoardDiff)
                    || (Math.Abs(pieceDiff - bestPieceDiff) < 1e-9
                        && Math.Abs(boardDiff - bestBoardDiff) < 1e-9
                        && Math.Abs(rows - cols) < Math.Abs(bestRows - bestCols));

                if (isBetter)
                {
                    bestPieceDiff = pieceDiff;
                    bestBoardDiff = boardDiff;
                    bestRows = rows;
                    bestCols = cols;
                }
            }

            var limit = (int)Math.Sqrt(pieceCount);
            for (int r = 1; r <= limit; r++)
            {
                if (pieceCount % r == 0)
                {
                    int c = pieceCount / r;
                    EvaluateCandidate(r, c);
                    if (c != r)
                    {
                        EvaluateCandidate(c, r);
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

            var placedRects = new List<(double x, double y, double w, double h)>(pieceCount);
            var piecePositions = new PiecePosition[pieceCount];
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
                var piecePosition = new PiecePosition(id, (float)startX, (float)startY, id);
                state.Pieces[id] = piecePosition;
                piecePositions[id] = piecePosition;
            }

            await Clients.Group(roomCode).SendAsync("BoardState", new
            {
                imageDataUrl = state.ImageDataUrl,
                pieceCount = state.PieceCount,
                boardWidth = state.BoardWidth,
                boardHeight = state.BoardHeight,
                rows = state.Rows,
                columns = state.Columns,
                pieces = piecePositions,
                lockedPieces = state.PieceLocks.Select(kvp => new { id = kvp.Key, ownerConnectionId = kvp.Value })
            });
        }
    }

    public async Task<PuzzleState?> JoinRoom(string roomCode)
    {
        if (Rooms.TryGetValue(roomCode, out var state))
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, roomCode);
            var userName = GetUserName(Context);
            state.Users[Context.ConnectionId] = userName;
            await Clients.Group(roomCode).SendAsync("UserList", state.Users.Values);
            await Clients.Caller.SendAsync("BoardState", new
            {
                imageDataUrl = state.ImageDataUrl,
                pieceCount = state.PieceCount,
                boardWidth = state.BoardWidth,
                boardHeight = state.BoardHeight,
                rows = state.Rows,
                columns = state.Columns,
                pieces = state.Pieces.Values,
                lockedPieces = state.PieceLocks.Select(kvp => new { id = kvp.Key, ownerConnectionId = kvp.Value })
            });
            return state;
        }

        return null;
    }

    public async Task LeaveRoom(string roomCode)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomCode);
        if (Rooms.TryGetValue(roomCode, out var state))
        {
            var releasedPieces = ReleaseLocksForConnection(state, Context.ConnectionId);
            state.Users.TryRemove(Context.ConnectionId, out _);
            await Clients.Group(roomCode).SendAsync("UserList", state.Users.Values);
            if (releasedPieces.Count > 0)
            {
                await Clients.Group(roomCode).SendAsync("PiecesUnlocked", releasedPieces);
            }
        }
    }

    /// <summary>
    /// Persists the new position of a piece and broadcasts it to clients in the
    /// same room.
    /// </summary>
    public async Task MovePiece(string roomCode, PiecePosition piece)
    {
        if (Rooms.TryGetValue(roomCode, out var state))
        {
            if (state.PieceLocks.TryGetValue(piece.Id, out var owner) && owner != Context.ConnectionId)
            {
                return;
            }
            state.Pieces[piece.Id] = piece;
            await Clients.Group(roomCode).SendAsync("PieceMoved", piece);
        }
    }

    public async Task<bool> TryLockPieces(string roomCode, int[] pieceIds)
    {
        if (!Rooms.TryGetValue(roomCode, out var state) || pieceIds.Length == 0)
        {
            return false;
        }

        lock (state.SyncRoot)
        {
            foreach (var pieceId in pieceIds)
            {
                if (state.PieceLocks.TryGetValue(pieceId, out var owner) && owner != Context.ConnectionId)
                {
                    return false;
                }
            }

            foreach (var pieceId in pieceIds)
            {
                state.PieceLocks[pieceId] = Context.ConnectionId;
            }
        }

        await Clients.Group(roomCode).SendAsync("PiecesLocked", pieceIds, Context.ConnectionId);
        return true;
    }

    public async Task ReleasePieces(string roomCode, int[] pieceIds)
    {
        if (!Rooms.TryGetValue(roomCode, out var state) || pieceIds.Length == 0)
        {
            return;
        }

        List<int> released;
        lock (state.SyncRoot)
        {
            released = new List<int>(pieceIds.Length);
            foreach (var pieceId in pieceIds)
            {
                if (state.PieceLocks.TryGetValue(pieceId, out var owner) && owner == Context.ConnectionId)
                {
                    if (state.PieceLocks.TryRemove(pieceId, out _))
                    {
                        released.Add(pieceId);
                    }
                }
            }
        }

        if (released.Count > 0)
        {
            await Clients.Group(roomCode).SendAsync("PiecesUnlocked", released);
        }
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        foreach (var kvp in Rooms)
        {
            var state = kvp.Value;
            var released = ReleaseLocksForConnection(state, Context.ConnectionId);
            if (released.Count > 0)
            {
                await Clients.Group(kvp.Key).SendAsync("PiecesUnlocked", released);
            }

            if (state.Users.TryRemove(Context.ConnectionId, out _))
            {
                await Clients.Group(kvp.Key).SendAsync("UserList", state.Users.Values);
                break;
            }
        }
        await base.OnDisconnectedAsync(exception);
    }

    private static List<int> ReleaseLocksForConnection(PuzzleState state, string connectionId)
    {
        lock (state.SyncRoot)
        {
            var released = new List<int>();
            foreach (var kvp in state.PieceLocks.ToArray())
            {
                if (kvp.Value == connectionId && state.PieceLocks.TryRemove(kvp.Key, out _))
                {
                    released.Add(kvp.Key);
                }
            }
            return released;
        }
    }
}
