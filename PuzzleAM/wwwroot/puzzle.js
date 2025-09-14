window.pieces = [];
window.pieceIndex = {};
// Track the highest z-index so groups can be brought to the front
window.maxZ = 1;
// Offset applied around the workspace for puzzle pieces
window.workspaceOffset = 0;
let hubConnection;
let currentRoomCode = null;
const locallyMovedPieces = new Set();
// Flag to ensure puzzle completion is only processed once
window.puzzleCompleted = false;

// Persist the current puzzle layout and image so it can be recreated later
window.currentLayout = null;
window.currentImageDataUrl = null;
window.currentContainerId = null;

// Load audio assets for various game events
const sounds = {
    start: new Audio('/audio/Start.wav'),
    connect: new Audio('/audio/Connect.wav'),
    applause: new Audio('/audio/Applause.wav')
};

let userListHandler;
window.registerUserListHandler = function (dotNetHelper) {
    userListHandler = dotNetHelper;
};

let puzzleEventHandler;
window.registerPuzzleEventHandler = function (dotNetHelper) {
    puzzleEventHandler = dotNetHelper;
};

function isMobileDevice() {
    if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
        return navigator.userAgentData.mobile;
    }
    const ua = navigator.userAgent || '';
    const mobileRegex = /Mobi|Android|iP(hone|ad|od)|BlackBerry|IEMobile|Opera Mini/i;
    return mobileRegex.test(ua) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 1);
}

function playStartSound() {
    try {
        sounds.start.currentTime = 0;
        sounds.start.play();
    } catch (e) {
        console.warn('Unable to play start sound', e);
    }
}

function playConnectSound() {
    try {
        sounds.connect.currentTime = 0;
        sounds.connect.play();
    } catch (e) {
        console.warn('Unable to play connect sound', e);
    }
}

function playApplauseSound() {
    try {
        sounds.applause.currentTime = 0;
        sounds.applause.play();
    } catch (e) {
        console.warn('Unable to play applause sound', e);
    }
}

async function startHubConnection() {
    hubConnection = new signalR.HubConnectionBuilder()
        .withUrl("/puzzlehub")
        .withAutomaticReconnect()
        .build();

    window.puzzleHub = hubConnection;

    hubConnection.onreconnected(async () => {
        if (currentRoomCode) {
            try {
                await hubConnection.invoke("JoinRoom", currentRoomCode);
            } catch (e) {
                console.error('Error rejoining room', e);
            }
        }
    });

    hubConnection.onclose(() => {
        connectionPromise = startHubConnection();
    });

    hubConnection.on("PieceMoved", data => {
        if (locallyMovedPieces.has(data.id)) {
            return;
        }

        const piece = window.pieces[data.id];
        if (piece) {
            if (typeof window.boardLeft === 'number' && typeof window.boardWidth === 'number') {
                piece.style.left = (window.boardLeft + data.left * window.boardWidth - window.workspaceOffset) + "px";
                piece.style.top = (window.boardTop + data.top * window.boardHeight - window.workspaceOffset) + "px";
            } else {
                piece.style.left = (data.left - window.workspaceOffset) + "px";
                piece.style.top = (data.top - window.workspaceOffset) + "px";
            }
            if (data.groupId != null) {
                piece.dataset.groupId = data.groupId;
            }
            if (window.currentLayout) {
                window.currentLayout.pieces = window.currentLayout.pieces || [];
                const stored = { id: data.id, left: data.left, top: data.top };
                if (data.groupId != null) {
                    stored.groupId = data.groupId;
                } else {
                    const g = parseInt(piece.dataset.groupId);
                    if (!isNaN(g)) stored.groupId = g;
                }
                window.currentLayout.pieces[data.id] = stored;
            }
            updatePieceShadow(piece);

            const row = parseInt(piece.dataset.row);
            const col = parseInt(piece.dataset.col);

            const topNeighbor = row > 0 ? window.pieces[(row - 1) * window.puzzleCols + col] : null;
            if (topNeighbor) {
                updatePieceShadow(topNeighbor);
            }

            const leftNeighbor = col > 0 ? window.pieces[row * window.puzzleCols + (col - 1)] : null;
            if (leftNeighbor) {
                updatePieceShadow(leftNeighbor);
            }

            const bottomNeighbor = row < window.puzzleRows - 1 ? window.pieces[(row + 1) * window.puzzleCols + col] : null;
            if (bottomNeighbor) {
                updatePieceShadow(bottomNeighbor);
            }

            const rightNeighbor = col < window.puzzleCols - 1 ? window.pieces[row * window.puzzleCols + (col + 1)] : null;
            if (rightNeighbor) {
                updatePieceShadow(rightNeighbor);
            }
        }
    });

    hubConnection.on("BoardState", state => {
        if (state.imageDataUrl) {
            window.createPuzzle(state.imageDataUrl, "puzzleContainer", state);
        }
    });

    hubConnection.on("UserList", users => {
        if (userListHandler) {
            userListHandler.invokeMethodAsync("ReceiveUserList", users);
        }
    });

    try {
        await hubConnection.start();
        if (currentRoomCode) {
            try {
                await hubConnection.invoke("JoinRoom", currentRoomCode);
            } catch (e) {
                console.error('Error joining room', e);
            }
        }
    } catch (err) {
        console.error(err);
    }
}

function sendMove(piece) {
    if (hubConnection && hubConnection.state === signalR.HubConnectionState.Connected &&
        typeof window.boardLeft === 'number' && typeof window.boardWidth === 'number') {
        const left = Math.round(parseFloat(piece.style.left) + window.workspaceOffset);
        const top = Math.round(parseFloat(piece.style.top) + window.workspaceOffset);
        const payload = {
            id: parseInt(piece.dataset.pieceId),
            left: (left - window.boardLeft) / window.boardWidth,
            top: (top - window.boardTop) / window.boardHeight
        };
        const groupId = parseInt(piece.dataset.groupId);
        if (Number.isFinite(groupId)) {
            payload.groupId = groupId;
        }
        if (window.currentLayout) {
            window.currentLayout.pieces = window.currentLayout.pieces || [];
            window.currentLayout.pieces[payload.id] = {
                id: payload.id,
                left: payload.left,
                top: payload.top,
                groupId: payload.groupId
            };
        }
        hubConnection.invoke("MovePiece", currentRoomCode, payload).catch(err => console.error(err));
    }
}

// Start the SignalR connection immediately instead of waiting for the window load event
let connectionPromise = startHubConnection();

async function ensureHubConnection() {
    if (!connectionPromise || !hubConnection ||
        hubConnection.state === signalR.HubConnectionState.Disconnected) {
        connectionPromise = startHubConnection();
    }
    try {
        await connectionPromise;
    } catch (err) {
        console.error('Error starting hub connection', err);
    }
}

// Rebuild puzzle on viewport changes using the stored layout (debounced)
let resizeTimeout;
function handleResize() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        if (window.currentImageDataUrl && window.currentLayout && window.currentContainerId) {
            window.createPuzzle(window.currentImageDataUrl, window.currentContainerId, window.currentLayout);
        }
    }, 200);
}
window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', handleResize);
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleResize);
}

window.setRoomCode = function (code) {
    currentRoomCode = code;
};

// Clear all puzzle-related state so no data leaks between rooms
window.resetPuzzleState = function () {
    window.pieces = [];
    window.pieceIndex = {};
    window.maxZ = 1;
    window.workspaceOffset = 0;
    window.puzzleCompleted = false;
    window.currentLayout = null;
    window.currentImageDataUrl = null;
    window.currentContainerId = null;
    window.boardLeft = undefined;
    window.boardTop = undefined;
    window.boardWidth = undefined;
    window.boardHeight = undefined;
    window.puzzleRows = undefined;
    window.puzzleCols = undefined;
    locallyMovedPieces.clear();
    const container = document.getElementById('puzzleContainer');
    if (container) {
        container.innerHTML = '';
    }
};

window.createRoom = async function (imageDataUrl, pieceCount) {
    await ensureHubConnection();
    if (hubConnection && hubConnection.state === signalR.HubConnectionState.Connected) {
        window.resetPuzzleState();
        const code = await hubConnection.invoke("CreateRoom", imageDataUrl || "", pieceCount || 0);
        window.setRoomCode(code);
        return code;
    }
    return null;
};

window.setPuzzle = async function (roomCode, imageDataUrl, pieceCount) {
    await ensureHubConnection();
    if (hubConnection && hubConnection.state === signalR.HubConnectionState.Connected) {
        try {
            await hubConnection.invoke("SetPuzzle", roomCode, imageDataUrl, pieceCount);
        } catch (error) {
            console.error('Error setting puzzle', error);
            alert('Failed to set puzzle. Please try again.');
        }
    }
};

window.joinRoom = async function (roomCode) {
    await ensureHubConnection();
    if (hubConnection && hubConnection.state === signalR.HubConnectionState.Connected) {
        window.resetPuzzleState();
        const state = await hubConnection.invoke("JoinRoom", roomCode);
        if (state) {
            window.setRoomCode(roomCode);
        }
        return state;
    }
    return null;
};

window.leaveRoom = async function () {
    await ensureHubConnection();
    if (hubConnection && hubConnection.state === signalR.HubConnectionState.Connected && currentRoomCode) {
        await hubConnection.invoke("LeaveRoom", currentRoomCode);
        currentRoomCode = null;
    }
    window.resetPuzzleState();
};

window.setBackgroundColor = function (color) {
    try {
        if (document.body) {
            document.body.style.backgroundColor = color;
        }
        if (document.documentElement) {
            document.documentElement.style.backgroundColor = color;
        }
        const container = document.getElementById('puzzleContainer');
        if (container) {
            container.style.backgroundColor = 'transparent';
        }
    } catch (error) {
        console.error('Error applying background color', error);
        throw error;
    }
};

window.createPuzzle = function (imageDataUrl, containerId, layout) {
    window.puzzleCompleted = false;
    const currentGeneration = (window.puzzleGeneration = (window.puzzleGeneration || 0) + 1);
    window.currentImageDataUrl = imageDataUrl;
    window.currentContainerId = containerId;
    window.currentLayout = {
        rows: layout.rows,
        columns: layout.columns,
        pieces: []
    };
    if (layout.pieces) {
        layout.pieces.forEach(p => {
            window.currentLayout.pieces[p.id] = { ...p };
        });
    }
    const img = new Image();
    img.onload = function () {
        if (currentGeneration !== window.puzzleGeneration) {
            return;
        }
        const rows = layout.rows;
        const cols = layout.columns;
        const piecesLayout = layout.pieces || [];
        const pieceMap = {};
        piecesLayout.forEach(p => pieceMap[p.id] = p);

        // Determine the bounding box of all pieces in the layout. This allows
        // us to scale the puzzle so that every piece—even ones scattered
        // outside of the solved board area—remains on-screen.
        const pieceNormWidth = 1 / cols;
        const pieceNormHeight = 1 / rows;
        let minLeft = 0;
        let minTop = 0;
        let maxRight = 1;
        let maxBottom = 1;
        piecesLayout.forEach(p => {
            const left = p.left ?? 0;
            const top = p.top ?? 0;
            if (left < minLeft) minLeft = left;
            if (top < minTop) minTop = top;
            const right = left + pieceNormWidth;
            const bottom = top + pieceNormHeight;
            if (right > maxRight) maxRight = right;
            if (bottom > maxBottom) maxBottom = bottom;
        });

        const container = document.getElementById(containerId);
        container.classList.add('puzzle-viewport');
        container.innerHTML = '';

        // Size the container to fill the viewport using visualViewport if available
        const viewportWidth = window.visualViewport ? window.visualViewport.width : window.innerWidth;
        const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        const containerRect = container.getBoundingClientRect();
        const availableWidth = viewportWidth - containerRect.left;
        const availableHeight = viewportHeight - containerRect.top;

        container.style.width = availableWidth + 'px';
        container.style.height = availableHeight + 'px';

        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;

        // Scale the puzzle so that the bounding box of all pieces fits within
        // the available viewport. This accounts for pieces that may start
        // scattered away from the board.
        const boundingNormalizedWidth = maxRight - minLeft;
        const boundingNormalizedHeight = maxBottom - minTop;

        let scale = Math.min(
            containerWidth / (img.width * boundingNormalizedWidth),
            containerHeight / (img.height * boundingNormalizedHeight)
        );
        let scaledWidth = img.width * scale;
        let scaledHeight = img.height * scale;
        let pieceWidth = scaledWidth / cols;
        let pieceHeight = scaledHeight / rows;
        let offset = Math.min(pieceWidth, pieceHeight) / 4;

        let boundingWidth = scaledWidth * boundingNormalizedWidth;
        let boundingHeight = scaledHeight * boundingNormalizedHeight;
        let totalWidth = boundingWidth + offset * 2;
        let totalHeight = boundingHeight + offset * 2;
        if (totalWidth > containerWidth || totalHeight > containerHeight) {
            const widthRatio = containerWidth / totalWidth;
            const heightRatio = containerHeight / totalHeight;
            const adjustment = Math.min(widthRatio, heightRatio);
            scale *= adjustment;
            scaledWidth *= adjustment;
            scaledHeight *= adjustment;
            pieceWidth = scaledWidth / cols;
            pieceHeight = scaledHeight / rows;
            offset = Math.min(pieceWidth, pieceHeight) / 4;
            boundingWidth = scaledWidth * boundingNormalizedWidth;
            boundingHeight = scaledHeight * boundingNormalizedHeight;
            totalWidth = boundingWidth + offset * 2;
            totalHeight = boundingHeight + offset * 2;
        }

        const workspace = document.createElement('div');
        workspace.classList.add('puzzle-workspace');
        workspace.style.width = (containerWidth + offset * 2) + 'px';
        workspace.style.height = (containerHeight + offset * 2) + 'px';
        workspace.style.padding = offset + 'px';
        workspace.style.left = '0';
        workspace.style.top = '0';
        workspace.style.transform = `translate(${-offset}px, ${-offset}px)`;
        container.appendChild(workspace);
        window.workspaceOffset = offset;

        const srcPieceWidth = img.width / cols;
        const srcPieceHeight = img.height / rows;
        const srcOffsetX = offset / scale;
        const srcOffsetY = offset / scale;

        let boardLeft = (containerWidth - boundingWidth) / 2 + offset - minLeft * scaledWidth;
        let boardTop = (containerHeight - boundingHeight) / 2 + offset - minTop * scaledHeight;

        // Ensure the puzzle board itself remains within the visible area even
        // if all pieces are shifted to one side.
        boardLeft = Math.max(boardLeft, offset);
        boardTop = Math.max(boardTop, offset);

        const board = document.createElement('div');
        board.classList.add('puzzle-board');
        board.style.left = boardLeft + 'px';
        board.style.top = boardTop + 'px';
        board.style.width = scaledWidth + 'px';
        board.style.height = scaledHeight + 'px';
        workspace.appendChild(board);

        window.puzzleRows = rows;
        window.puzzleCols = cols;
        window.boardLeft = boardLeft;
        window.boardTop = boardTop;
        window.boardWidth = scaledWidth;
        window.boardHeight = scaledHeight;

        const hTabs = Array.from({ length: rows }, () => Array(cols));
        const vTabs = Array.from({ length: rows }, () => Array(cols));

        window.pieces = [];
        window.pieceIndex = {};

        let y = 0;
        let x = 0;
        const batchSize = 50;

        function buildNextBatch() {
            if (currentGeneration !== window.puzzleGeneration) {
                return;
            }
            let count = 0;
            while (y < rows && count < batchSize) {
                const top = y === 0 ? 0 : -vTabs[y - 1][x];
                const left = x === 0 ? 0 : -hTabs[y][x - 1];
                const right = x === cols - 1 ? 0 : (hTabs[y][x] = Math.random() > 0.5 ? 1 : -1);
                const bottom = y === rows - 1 ? 0 : (vTabs[y][x] = Math.random() > 0.5 ? 1 : -1);

                const piece = document.createElement('canvas');
                piece.width = pieceWidth + offset * 2;
                piece.height = pieceHeight + offset * 2;
                piece.classList.add('puzzle-piece');

                const pieceIndex = window.pieces.length;
                const p = pieceMap[pieceIndex] || { left: 0, top: 0, groupId: pieceIndex };
                piece.style.left = boardLeft + p.left * scaledWidth - window.workspaceOffset + 'px';
                piece.style.top = boardTop + p.top * scaledHeight - window.workspaceOffset + 'px';

                if (window.currentLayout) {
                    window.currentLayout.pieces[pieceIndex] = {
                        id: pieceIndex,
                        left: p.left,
                        top: p.top,
                        groupId: p.groupId !== undefined ? p.groupId : pieceIndex
                    };
                }

                const correctX = boardLeft + x * pieceWidth - window.workspaceOffset;
                const correctY = boardTop + y * pieceHeight - window.workspaceOffset;
                piece.dataset.correctX = correctX;
                piece.dataset.correctY = correctY;
                piece.dataset.width = pieceWidth;
                piece.dataset.height = pieceHeight;
                piece.dataset.groupId = p.groupId !== undefined ? p.groupId : pieceIndex;
                piece.dataset.pieceId = pieceIndex;
                piece.dataset.row = y;
                piece.dataset.col = x;

                const ctx = piece.getContext('2d');
                ctx.imageSmoothingEnabled = false;
                ctx.clearRect(0, 0, piece.width, piece.height);
                ctx.save();
                ctx.translate(0.5, 0.5);
                drawPiecePath(ctx, pieceWidth, pieceHeight, top, right, bottom, left, offset);
                ctx.clip();
                ctx.drawImage(
                    img,
                    x * srcPieceWidth - srcOffsetX,
                    y * srcPieceHeight - srcOffsetY,
                    srcPieceWidth + srcOffsetX * 2,
                    srcPieceHeight + srcOffsetY * 2,
                    0,
                    0,
                    piece.width,
                    piece.height
                );
                ctx.restore();
                workspace.appendChild(piece);
                window.pieces.push(piece);
                window.pieceIndex[`${y},${x}`] = piece;
                makeDraggable(piece, workspace);

                x++;
                if (x === cols) {
                    x = 0;
                    y++;
                }
                count++;
            }
            if (y < rows) {
                requestAnimationFrame(buildNextBatch);
            } else if (currentGeneration === window.puzzleGeneration) {
                updateAllShadows();
                playStartSound();
                if (puzzleEventHandler) {
                    puzzleEventHandler.invokeMethodAsync('PuzzleLoaded');
                }
            }
        }

        requestAnimationFrame(buildNextBatch);
    };
    img.src = imageDataUrl;
};

function drawPiecePath(ctx, w, h, top, right, bottom, left, offset) {
    const radius = Math.min(w, h) / 6;
    const neck = radius / 2;
    ctx.beginPath();
    ctx.moveTo(offset, offset);

    // top edge
    if (top === 0) {
        ctx.lineTo(offset + w, offset);
    } else {
        const dir = top;
        const centerX = offset + w / 2;
        const startX = centerX - radius;
        const endX = centerX + radius;
        ctx.lineTo(startX, offset);
        ctx.lineTo(startX, offset - neck * dir);
        ctx.arc(centerX, offset - neck * dir, radius, Math.PI, 0, dir === -1);
        ctx.lineTo(endX, offset - neck * dir);
        ctx.lineTo(endX, offset);
        ctx.lineTo(offset + w, offset);
    }

    // right edge
    if (right === 0) {
        ctx.lineTo(offset + w, offset + h);
    } else {
        const dir = right;
        const centerY = offset + h / 2;
        const startY = centerY - radius;
        const endY = centerY + radius;
        ctx.lineTo(offset + w, startY);
        ctx.lineTo(offset + w + neck * dir, startY);
        ctx.arc(offset + w + neck * dir, centerY, radius, -Math.PI / 2, Math.PI / 2, dir === -1);
        ctx.lineTo(offset + w + neck * dir, endY);
        ctx.lineTo(offset + w, endY);
        ctx.lineTo(offset + w, offset + h);
    }

    // bottom edge
    if (bottom === 0) {
        ctx.lineTo(offset, offset + h);
    } else {
        const dir = bottom;
        const centerX = offset + w / 2;
        const startX = centerX + radius;
        const endX = centerX - radius;
        ctx.lineTo(startX, offset + h);
        ctx.lineTo(startX, offset + h + neck * dir);
        ctx.arc(centerX, offset + h + neck * dir, radius, 0, Math.PI, dir === -1);
        ctx.lineTo(endX, offset + h + neck * dir);
        ctx.lineTo(endX, offset + h);
        ctx.lineTo(offset, offset + h);
    }

    // left edge
    if (left === 0) {
        ctx.lineTo(offset, offset);
    } else {
        const dir = left;
        const centerY = offset + h / 2;
        const startY = centerY + radius;
        const endY = centerY - radius;
        ctx.lineTo(offset, startY);
        ctx.lineTo(offset - neck * dir, startY);
        ctx.arc(offset - neck * dir, centerY, radius, Math.PI / 2, -Math.PI / 2, dir === -1);
        ctx.lineTo(offset - neck * dir, endY);
        ctx.lineTo(offset, endY);
        ctx.lineTo(offset, offset);
    }

    ctx.closePath();
}

function setGroupLayer(groupPieces) {
    window.maxZ += 1;
    groupPieces.forEach(p => p.style.zIndex = window.maxZ);
}

function updatePieceShadow(piece) {
    const groupId = parseInt(piece.dataset.groupId);
    const groupSize = window.pieces.filter(p => parseInt(p.dataset.groupId) === groupId).length;

    if (groupSize > 1) {
        // Any piece that is part of a connected group should not render a shadow
        piece.style.filter = 'none';
        return;
    }

    // Single pieces retain a subtle shadow so they stand out on the board
    piece.style.filter = 'drop-shadow(0 3px 6px rgba(0, 0, 0, 0.5)) drop-shadow(3px 0 6px rgba(0, 0, 0, 0.5))';
}

function updateAllShadows() {
    window.pieces.forEach(updatePieceShadow);
}

function makeDraggable(el, container) {
    let offsetX = 0, offsetY = 0, lastX = 0, lastY = 0;

    const startDrag = (event) => {
        event.preventDefault();
        const rect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const clientX = event.clientX ?? event.touches[0].clientX;
        const clientY = event.clientY ?? event.touches[0].clientY;
        offsetX = clientX - rect.left;
        offsetY = clientY - rect.top;
        lastX = parseFloat(el.style.left);
        lastY = parseFloat(el.style.top);
        const groupId = parseInt(el.dataset.groupId);
        const piecesToMove = window.pieces.filter(p => parseInt(p.dataset.groupId) === groupId);
        setGroupLayer(piecesToMove);

        piecesToMove.forEach(p => {
            locallyMovedPieces.add(parseInt(p.dataset.pieceId));
        });

        const onMove = (e) => {
            const moveX = (e.clientX ?? e.touches[0].clientX) - containerRect.left - offsetX;
            const moveY = (e.clientY ?? e.touches[0].clientY) - containerRect.top - offsetY;
            let dx = moveX - lastX;
            let dy = moveY - lastY;

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            piecesToMove.forEach(p => {
                const left = parseFloat(p.style.left);
                const top = parseFloat(p.style.top);
                const w = p.offsetWidth;
                const h = p.offsetHeight;
                if (left < minX) minX = left;
                if (top < minY) minY = top;
                if (left + w > maxX) maxX = left + w;
                if (top + h > maxY) maxY = top + h;
            });

            const workspaceWidth = container.clientWidth - window.workspaceOffset * 2;
            const workspaceHeight = container.clientHeight - window.workspaceOffset * 2;
            if (minX + dx < -window.workspaceOffset) dx = -window.workspaceOffset - minX;
            if (minY + dy < -window.workspaceOffset) dy = -window.workspaceOffset - minY;
            if (maxX + dx > workspaceWidth - window.workspaceOffset) dx = workspaceWidth - window.workspaceOffset - maxX;
            if (maxY + dy > workspaceHeight - window.workspaceOffset) dy = workspaceHeight - window.workspaceOffset - maxY;

            piecesToMove.forEach(p => {
                p.style.left = (parseFloat(p.style.left) + dx) + 'px';
                p.style.top = (parseFloat(p.style.top) + dy) + 'px';
                sendMove(p);
            });

            lastX += dx;
            lastY += dy;
        };

        const stop = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('mouseup', stop);
            document.removeEventListener('touchend', stop);
            piecesToMove.forEach(sendMove);
            piecesToMove.forEach(p => {
                locallyMovedPieces.delete(parseInt(p.dataset.pieceId));
            });
            snapPiece(el);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('touchmove', onMove);
        document.addEventListener('mouseup', stop);
        document.addEventListener('touchend', stop);
    };

    el.addEventListener('mousedown', startDrag);
    el.addEventListener('touchstart', startDrag);
}

function getAdjacentPieces(piece) {
    const row = parseInt(piece.dataset.row);
    const col = parseInt(piece.dataset.col);
    const neighbors = [];
    const positions = [
        [row - 1, col],
        [row + 1, col],
        [row, col - 1],
        [row, col + 1]
    ];
    for (const [r, c] of positions) {
        const neighbor = window.pieceIndex[`${r},${c}`];
        if (neighbor) {
            neighbors.push(neighbor);
        }
    }
    return neighbors;
}

function snapPiece(el) {
    const threshold = 15;
    const groupId = parseInt(el.dataset.groupId);
    let merged;

    do {
        merged = false;
        const groupPieces = window.pieces.filter(p => parseInt(p.dataset.groupId) === groupId);

        // Check all pieces in the group for connections to other groups
        outer: for (const piece of groupPieces) {
            const pieceCorrectX = parseFloat(piece.dataset.correctX);
            const pieceCorrectY = parseFloat(piece.dataset.correctY);
            const pieceCurrentX = parseFloat(piece.style.left);
            const pieceCurrentY = parseFloat(piece.style.top);

            const neighbors = getAdjacentPieces(piece);
            for (const neighbor of neighbors) {
                if (parseInt(neighbor.dataset.groupId) === groupId) continue;

                const expectedDx = parseFloat(neighbor.dataset.correctX) - pieceCorrectX;
                const expectedDy = parseFloat(neighbor.dataset.correctY) - pieceCorrectY;

                const actualDx = parseFloat(neighbor.style.left) - pieceCurrentX;
                const actualDy = parseFloat(neighbor.style.top) - pieceCurrentY;
                const offsetX = actualDx - expectedDx;
                const offsetY = actualDy - expectedDy;

                // Compare using the raw offsets so near-threshold pieces still connect,
                // then round the adjustment applied to the pieces to avoid seams.
                if (Math.abs(offsetX) < threshold && Math.abs(offsetY) < threshold) {
                    const diffX = Math.round(offsetX);
                    const diffY = Math.round(offsetY);
                    groupPieces.forEach(p => {
                        p.style.left = (parseFloat(p.style.left) + diffX) + 'px';
                        p.style.top = (parseFloat(p.style.top) + diffY) + 'px';
                        sendMove(p);
                    });

                    const neighborGroupId = parseInt(neighbor.dataset.groupId);
                    window.pieces.forEach(p => {
                        if (parseInt(p.dataset.groupId) === neighborGroupId) {
                            p.dataset.groupId = groupId;
                        }
                    });

                    const finalGroup = window.pieces.filter(p => parseInt(p.dataset.groupId) === groupId);
                    setGroupLayer(finalGroup);
                    finalGroup.forEach(p => {
                        p.style.filter = 'none';
                        sendMove(p);
                    });
                    playConnectSound();
                    updateAllShadows();
                    checkCompletion();
                    merged = true;
                    break outer;
                }
            }
        }
    } while (merged);

    updateAllShadows();
    checkCompletion();
}

function checkCompletion() {
    if (window.puzzleCompleted || window.pieces.length === 0) return;
    const groupId = window.pieces[0].dataset.groupId;
    const solved = window.pieces.every(p => p.dataset.groupId === groupId);
    if (solved) {
        window.puzzleCompleted = true;
        console.log('Puzzle completed!');
        playApplauseSound();
        if (puzzleEventHandler) {
            puzzleEventHandler.invokeMethodAsync('PuzzleCompleted');
        }
    }
}

window.closeModal = function (id) {
    const el = document.getElementById(id);
    if (!el) {
        return;
    }
    const modal = bootstrap.Modal.getInstance(el) || new bootstrap.Modal(el);
    modal.hide();
};

window.register = async function (token, model) {
    const response = await fetch('/register', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'RequestVerificationToken': token
        },
        body: JSON.stringify(model),
        credentials: 'include'
    });
    return response.ok;
};

window.login = async function (token, model) {
    const response = await fetch('/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'RequestVerificationToken': token
        },
        body: JSON.stringify(model),
        credentials: 'include'
    });
    return response.ok;
};

window.logout = async function (token) {
    const response = await fetch('/logout', {
        method: 'POST',
        headers: {
            'RequestVerificationToken': token
        },
        credentials: 'include'
    });
    return response.ok;
};

window.restartHubConnection = async function () {
    if (hubConnection) {
        try {
            await hubConnection.stop();
        } catch (e) {
            console.error(e);
        }
    }
    connectionPromise = startHubConnection();
    await connectionPromise;
};

window.initTooltips = function () {
    const triggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    triggerList.map(el => new bootstrap.Tooltip(el));
};

window.toggleFullScreen = function () {
    try {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    } catch (e) {
        console.error('Error toggling full screen', e);
    }
};
