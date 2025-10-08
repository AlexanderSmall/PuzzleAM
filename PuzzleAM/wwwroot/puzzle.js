window.pieces = [];
window.pieceIndex = {};
// Track the highest z-index so groups can be brought to the front
window.maxZ = 1;
// Offset applied around the workspace for puzzle pieces
window.workspaceOffset = 0;
// Small overlap applied to each piece so adjacent edges cover seams when snapped.
const PIECE_OVERLAP = 2;
window.lockedPieces = new Map();
let hubConnection;
let currentRoomCode = null;
const locallyMovedPieces = new Set();
// Flag to ensure puzzle completion is only processed once
window.puzzleCompleted = false;
// Track whether the start and applause sounds have already been played for the
// current puzzle so resize/orientation changes do not replay them.
window.startSoundPlayed = false;
window.applauseSoundPlayed = false;

// Persist the current puzzle layout and image so it can be recreated later
window.currentLayout = null;
window.currentImageDataUrl = null;
window.currentContainerId = null;

async function loadPuzzleImage(imageDataUrl) {
    if (!imageDataUrl) {
        throw new Error('Image data URL is required.');
    }

    if (typeof window.createImageBitmap === 'function') {
        try {
            const response = await fetch(imageDataUrl);
            const blob = await response.blob();
            const bitmap = await createImageBitmap(blob);
            return {
                source: bitmap,
                width: bitmap.width,
                height: bitmap.height,
                cleanup: () => bitmap.close()
            };
        } catch (err) {
            console.warn('createImageBitmap failed, falling back to HTMLImageElement decoding', err);
        }
    }

    return await new Promise((resolve, reject) => {
        const img = new Image();
        img.decoding = 'async';
        img.loading = 'eager';
        img.onload = () => resolve({
            source: img,
            width: img.naturalWidth || img.width,
            height: img.naturalHeight || img.height,
            cleanup: () => { }
        });
        img.onerror = reject;
        img.src = imageDataUrl;
    });
}

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

let viewportResizeHandler;
window.registerViewportResizeHandler = function (dotNetHelper) {
    if (viewportResizeHandler) {
        window.removeEventListener('resize', viewportResizeHandler);
    }

    viewportResizeHandler = () => {
        if (!dotNetHelper) {
            return;
        }

        try {
            dotNetHelper.invokeMethodAsync('OnViewportResize', window.innerWidth || 0);
        } catch (err) {
            console.error('Error notifying viewport resize handler', err);
        }
    };

    window.addEventListener('resize', viewportResizeHandler);
};

window.disposeViewportResizeHandler = function () {
    if (!viewportResizeHandler) {
        return;
    }

    window.removeEventListener('resize', viewportResizeHandler);
    viewportResizeHandler = null;
};

function notifyPuzzleLoading(isLoading) {
    if (!puzzleEventHandler) {
        return;
    }
    try {
        puzzleEventHandler.invokeMethodAsync('PuzzleLoading', isLoading);
    } catch (err) {
        console.error('Error notifying loading state', err);
    }
}

function isMobileDevice() {
    if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
        return navigator.userAgentData.mobile;
    }
    const ua = navigator.userAgent || '';
    const mobileRegex = /Mobi|Android|iP(hone|ad|od)|BlackBerry|IEMobile|Opera Mini/i;
    return mobileRegex.test(ua) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 1);
}

function playStartSound() {
    if (window.startSoundPlayed) {
        return;
    }
    window.startSoundPlayed = true;
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
    if (window.applauseSoundPlayed) {
        return;
    }
    window.applauseSoundPlayed = true;
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
        .withAutomaticReconnect([0, 2, 5, 10])
        .build();

    window.puzzleHub = hubConnection;

    hubConnection.onreconnected(async () => {
        if (currentRoomCode) {
            try {
                await hubConnection.invoke("JoinRoom", currentRoomCode);
                if (puzzleEventHandler) {
                    try {
                        await puzzleEventHandler.invokeMethodAsync("OnHubReconnected");
                    } catch (err) {
                        console.error('Error notifying reconnection handler', err);
                    }
                }
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
                const existingLayout = window.currentLayout.pieces[data.id] || {};
                const stored = { ...existingLayout, id: data.id, left: data.left, top: data.top };
                if (data.groupId != null) {
                    stored.groupId = data.groupId;
                } else if (existingLayout.groupId != null) {
                    stored.groupId = existingLayout.groupId;
                } else {
                    const g = parseInt(piece.dataset.groupId);
                    if (!isNaN(g)) stored.groupId = g;
                }
                ["topTab", "rightTab", "bottomTab", "leftTab"].forEach(key => {
                    if (typeof data[key] === 'number') {
                        stored[key] = data[key];
                    }
                });
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

    hubConnection.on("PiecesLocked", (pieceIds, ownerConnectionId) => {
        if (!Array.isArray(pieceIds)) {
            return;
        }
        pieceIds.forEach(id => {
            window.lockedPieces.set(id, ownerConnectionId);
        });
        refreshLockVisuals(pieceIds);
    });

    hubConnection.on("PiecesUnlocked", pieceIds => {
        if (!Array.isArray(pieceIds)) {
            return;
        }
        pieceIds.forEach(id => {
            window.lockedPieces.delete(id);
        });
        refreshLockVisuals(pieceIds);
    });

    hubConnection.on("BoardState", state => {
        if (!state || !state.imageDataUrl) {
            return;
        }

        const isNewPuzzleImage = state.imageDataUrl !== window.currentImageDataUrl;
        if (isNewPuzzleImage) {
            window.resetPuzzleState();
        }

        window.createPuzzle(state.imageDataUrl, "puzzleContainer", state);
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
        const left = parseFloat(piece.style.left) + window.workspaceOffset;
        const top = parseFloat(piece.style.top) + window.workspaceOffset;
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
            const existingLayout = window.currentLayout.pieces[payload.id] || {};
            const updatedLayout = { ...existingLayout, id: payload.id, left: payload.left, top: payload.top };
            if (payload.groupId != null) {
                updatedLayout.groupId = payload.groupId;
            } else if (existingLayout.groupId != null) {
                updatedLayout.groupId = existingLayout.groupId;
            }
            ["topTab", "rightTab", "bottomTab", "leftTab"].forEach(key => {
                if (typeof existingLayout[key] === 'number') {
                    payload[key] = existingLayout[key];
                    updatedLayout[key] = existingLayout[key];
                }
            });
            window.currentLayout.pieces[payload.id] = updatedLayout;
        }
        hubConnection.invoke("MovePiece", currentRoomCode, payload).catch(err => console.error(err));
    }
}

async function requestPieceLock(pieceIds) {
    if (!Array.isArray(pieceIds) || pieceIds.length === 0) {
        return false;
    }

    await ensureHubConnection();
    if (!hubConnection || hubConnection.state !== signalR.HubConnectionState.Connected) {
        return false;
    }

    try {
        const result = await hubConnection.invoke("TryLockPieces", currentRoomCode, pieceIds);
        return result === true;
    } catch (err) {
        console.error('Error requesting piece lock', err);
        return false;
    }
}

async function releasePieceLock(pieceIds) {
    if (!Array.isArray(pieceIds) || pieceIds.length === 0) {
        return;
    }

    if (!hubConnection || hubConnection.state !== signalR.HubConnectionState.Connected) {
        return;
    }

    try {
        await hubConnection.invoke("ReleasePieces", currentRoomCode, pieceIds);
    } catch (err) {
        console.error('Error releasing piece lock', err);
    }
}

// Start the SignalR connection immediately instead of waiting for the window load event
let connectionPromise = startHubConnection();

function resumeHubConnectionIfNeeded() {
    if (document.hidden) {
        return;
    }

    ensureHubConnection();
}

window.addEventListener('visibilitychange', resumeHubConnectionIfNeeded);
window.addEventListener('focus', resumeHubConnectionIfNeeded);

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
    window.startSoundPlayed = false;
    window.applauseSoundPlayed = false;
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
    window.lockedPieces.clear();
    const container = document.getElementById('puzzleContainer');
    if (container) {
        container.innerHTML = '';
    }
    if (puzzleEventHandler) {
        try {
            puzzleEventHandler.invokeMethodAsync('PuzzleReset');
        } catch (err) {
            console.error('Error notifying puzzle reset', err);
        }
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

async function waitForConnectedState(timeoutMs = 10000) {
    const connection = hubConnection;
    if (!connection) {
        return false;
    }

    if (connection.state === signalR.HubConnectionState.Connected) {
        return true;
    }

    const start = Date.now();

    return await new Promise(resolve => {
        const checkState = () => {
            if (!hubConnection) {
                resolve(false);
                return;
            }

            const state = hubConnection.state;
            if (state === signalR.HubConnectionState.Connected) {
                resolve(true);
                return;
            }

            if (state === signalR.HubConnectionState.Disconnected) {
                resolve(false);
                return;
            }

            if (Date.now() - start >= timeoutMs) {
                resolve(false);
                return;
            }

            setTimeout(checkState, 100);
        };

        checkState();
    });
}

window.setPuzzle = async function (roomCode, imageDataUrl, pieceCount) {
    await ensureHubConnection();

    const isConnected = await waitForConnectedState();
    if (!isConnected) {
        console.info('SetPuzzle deferred because the hub connection is not ready.');
        return false;
    }

    try {
        await hubConnection.invoke("SetPuzzle", roomCode, imageDataUrl, pieceCount);
        return true;
    } catch (error) {
        console.error('Error setting puzzle', error);
        alert('Failed to set puzzle. Please try again.');
        throw error;
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

window.createPuzzle = async function (imageDataUrl, containerId, layout) {
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
            if (!p || typeof p.id !== 'number') {
                return;
            }
            window.currentLayout.pieces[p.id] = { ...p };
        });
    }

    window.lockedPieces.clear();
    if (layout.lockedPieces && Array.isArray(layout.lockedPieces)) {
        layout.lockedPieces.forEach(lock => {
            if (lock && typeof lock.id === 'number') {
                window.lockedPieces.set(lock.id, lock.ownerConnectionId);
            }
        });
    }

    notifyPuzzleLoading(true);

    let loadedImage;
    try {
        loadedImage = await loadPuzzleImage(imageDataUrl);
    } catch (error) {
        console.error('Failed to decode puzzle image', error);
        notifyPuzzleLoading(false);
        return;
    }

    const { source, width: imageWidth, height: imageHeight, cleanup } = loadedImage;
    let cleanedUp = false;
    const disposeSource = () => {
        if (!cleanedUp) {
            cleanedUp = true;
            cleanup();
        }
    };

    try {
        if (currentGeneration !== window.puzzleGeneration) {
            disposeSource();
            return;
        }

        const rows = layout.rows;
        const cols = layout.columns;
        const piecesLayout = layout.pieces || [];
        const pieceMap = {};
        piecesLayout.forEach(p => {
            pieceMap[p.id] = p;
        });

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
        if (!container) {
            notifyPuzzleLoading(false);
            disposeSource();
            return;
        }
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
            containerWidth / (imageWidth * boundingNormalizedWidth),
            containerHeight / (imageHeight * boundingNormalizedHeight)
        );

        const scaledPieceWidth = (imageWidth * scale) / cols;
        const scaledPieceHeight = (imageHeight * scale) / rows;
        const quantizedPieceWidth = Math.max(1, Math.round(scaledPieceWidth));
        const quantizedPieceHeight = Math.max(1, Math.round(scaledPieceHeight));
        let quantizedScale = Math.min(
            scale,
            (quantizedPieceWidth * cols) / imageWidth,
            (quantizedPieceHeight * rows) / imageHeight
        );

        let scaledWidth = Math.round(imageWidth * quantizedScale);
        let scaledHeight = Math.round(imageHeight * quantizedScale);
        let pieceWidth = Math.max(1, Math.round(scaledWidth / cols));
        let pieceHeight = Math.max(1, Math.round(scaledHeight / rows));
        let offset = Math.max(0, Math.round(Math.min(pieceWidth, pieceHeight) / 4));
        const tabRadius = Math.min(pieceWidth, pieceHeight) / 6;
        const tabNeck = tabRadius / 2;
        const minimumPadding = PIECE_OVERLAP + tabRadius + tabNeck;
        offset = Math.max(offset, Math.ceil(minimumPadding));

        let boundingWidth = scaledWidth * boundingNormalizedWidth;
        let boundingHeight = scaledHeight * boundingNormalizedHeight;
        let totalWidth = boundingWidth + offset * 2;
        let totalHeight = boundingHeight + offset * 2;
        if (totalWidth > containerWidth || totalHeight > containerHeight) {
            const widthRatio = containerWidth / totalWidth;
            const heightRatio = containerHeight / totalHeight;
            const adjustment = Math.min(widthRatio, heightRatio);
            quantizedScale *= adjustment;
            scaledWidth = Math.round(imageWidth * quantizedScale);
            scaledHeight = Math.round(imageHeight * quantizedScale);
            pieceWidth = Math.max(1, Math.round(scaledWidth / cols));
            pieceHeight = Math.max(1, Math.round(scaledHeight / rows));
            offset = Math.max(0, Math.round(Math.min(pieceWidth, pieceHeight) / 4));
            const adjustedTabRadius = Math.min(pieceWidth, pieceHeight) / 6;
            const adjustedTabNeck = adjustedTabRadius / 2;
            const adjustedMinimumPadding = PIECE_OVERLAP + adjustedTabRadius + adjustedTabNeck;
            offset = Math.max(offset, Math.ceil(adjustedMinimumPadding));
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

        const renderOffset = offset;
        const srcPieceWidth = imageWidth / cols;
        const srcPieceHeight = imageHeight / rows;
        const epsilon = 1e-6;
        const scaleX = pieceWidth / Math.max(srcPieceWidth, epsilon);
        const scaleY = pieceHeight / Math.max(srcPieceHeight, epsilon);
        const srcOffsetX = renderOffset / Math.max(scaleX, epsilon);
        const srcOffsetY = renderOffset / Math.max(scaleY, epsilon);

        let boardLeft = Math.round((containerWidth - boundingWidth) / 2 + offset - minLeft * scaledWidth);
        let boardTop = Math.round((containerHeight - boundingHeight) / 2 + offset - minTop * scaledHeight);

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
                disposeSource();
                return;
            }

            try {
                let count = 0;
                const fragment = document.createDocumentFragment();
                while (y < rows && count < batchSize) {
                    const pieceIndex = window.pieces.length;
                    const layoutPiece = pieceMap[pieceIndex] || {};
                    const abovePiece = y > 0 ? pieceMap[(y - 1) * cols + x] : null;
                    const leftPiece = x > 0 ? pieceMap[pieceIndex - 1] : null;

                    const getOrientation = (piece, key) =>
                        piece && typeof piece[key] === 'number' ? piece[key] : null;

                    let top = getOrientation(layoutPiece, 'topTab');
                    if (typeof top !== 'number') {
                        if (y === 0) {
                            top = 0;
                        } else {
                            const aboveBottom = getOrientation(abovePiece, 'bottomTab');
                            if (typeof aboveBottom === 'number') {
                                top = -aboveBottom;
                            } else if (typeof vTabs[y - 1][x] === 'number') {
                                top = -vTabs[y - 1][x];
                            } else {
                                top = 0;
                            }
                        }
                    }

                    let left = getOrientation(layoutPiece, 'leftTab');
                    if (typeof left !== 'number') {
                        if (x === 0) {
                            left = 0;
                        } else {
                            const leftRight = getOrientation(leftPiece, 'rightTab');
                            if (typeof leftRight === 'number') {
                                left = -leftRight;
                            } else if (typeof hTabs[y][x - 1] === 'number') {
                                left = -hTabs[y][x - 1];
                            } else {
                                left = 0;
                            }
                        }
                    }

                    let right = getOrientation(layoutPiece, 'rightTab');
                    if (typeof right !== 'number') {
                        if (x === cols - 1) {
                            right = 0;
                        } else if (typeof hTabs[y][x] === 'number') {
                            right = hTabs[y][x];
                        } else {
                            right = Math.random() > 0.5 ? 1 : -1;
                        }
                    }
                    hTabs[y][x] = right;

                    let bottom = getOrientation(layoutPiece, 'bottomTab');
                    if (typeof bottom !== 'number') {
                        if (y === rows - 1) {
                            bottom = 0;
                        } else if (typeof vTabs[y][x] === 'number') {
                            bottom = vTabs[y][x];
                        } else {
                            bottom = Math.random() > 0.5 ? 1 : -1;
                        }
                    }
                    vTabs[y][x] = bottom;

                    const normalizedLayoutPiece = {
                        ...layoutPiece,
                        id: pieceIndex,
                        left: typeof layoutPiece.left === 'number' ? layoutPiece.left : 0,
                        top: typeof layoutPiece.top === 'number' ? layoutPiece.top : 0,
                        groupId: layoutPiece.groupId !== undefined ? layoutPiece.groupId : pieceIndex,
                        topTab: top,
                        rightTab: right,
                        bottomTab: bottom,
                        leftTab: left
                    };
                    pieceMap[pieceIndex] = normalizedLayoutPiece;

                    const piece = document.createElement('canvas');
                    piece.width = pieceWidth + renderOffset * 2;
                    piece.height = pieceHeight + renderOffset * 2;
                    piece.classList.add('puzzle-piece');

                    const initialLeft = Math.round(boardLeft + normalizedLayoutPiece.left * scaledWidth - window.workspaceOffset);
                    const initialTop = Math.round(boardTop + normalizedLayoutPiece.top * scaledHeight - window.workspaceOffset);
                    piece.style.left = initialLeft + 'px';
                    piece.style.top = initialTop + 'px';

                    if (window.currentLayout) {
                        window.currentLayout.pieces[pieceIndex] = { ...normalizedLayoutPiece };
                    }

                    const correctX = boardLeft + x * pieceWidth - window.workspaceOffset;
                    const correctY = boardTop + y * pieceHeight - window.workspaceOffset;
                    piece.dataset.correctX = correctX;
                    piece.dataset.correctY = correctY;
                    piece.dataset.width = pieceWidth;
                    piece.dataset.height = pieceHeight;
                    piece.dataset.groupId = normalizedLayoutPiece.groupId;
                    piece.dataset.pieceId = pieceIndex;
                    piece.dataset.row = y;
                    piece.dataset.col = x;
                    piece.dataset.topTab = top;
                    piece.dataset.rightTab = right;
                    piece.dataset.bottomTab = bottom;
                    piece.dataset.leftTab = left;

                    const ctx = piece.getContext('2d');
                    ctx.imageSmoothingEnabled = false;
                    ctx.clearRect(0, 0, piece.width, piece.height);
                    ctx.save();
                    drawPiecePath(ctx, pieceWidth, pieceHeight, top, right, bottom, left, renderOffset, PIECE_OVERLAP);
                    ctx.clip();
                    ctx.drawImage(
                        source,
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
                    fragment.appendChild(piece);
                    window.pieces.push(piece);
                    window.pieceIndex[`${y},${x}`] = piece;
                    makeDraggable(piece, workspace);
                    refreshPieceLockVisual(pieceIndex);

                    x++;
                    if (x === cols) {
                        x = 0;
                        y++;
                    }
                    count++;
                }

                if (fragment.childNodes.length > 0) {
                    workspace.appendChild(fragment);
                }

                if (y < rows) {
                    requestAnimationFrame(buildNextBatch);
                } else if (currentGeneration === window.puzzleGeneration) {
                    updateAllShadows();
                    playStartSound();
                    notifyPuzzleLoading(false);
                    if (puzzleEventHandler) {
                        puzzleEventHandler.invokeMethodAsync('PuzzleLoaded');
                    }
                    disposeSource();
                }
            } catch (err) {
                console.error('Error while generating puzzle pieces', err);
                notifyPuzzleLoading(false);
                disposeSource();
            }
        }

        requestAnimationFrame(buildNextBatch);
    } catch (error) {
        console.error('Error constructing puzzle', error);
        notifyPuzzleLoading(false);
        disposeSource();
    }
};

function drawPiecePath(ctx, w, h, top, right, bottom, left, padding, overlap) {
    const radius = Math.min(w, h) / 6;
    const neck = radius / 2;
    const leftEdge = padding - overlap;
    const rightEdge = padding + w + overlap;
    const topEdge = padding - overlap;
    const bottomEdge = padding + h + overlap;

    ctx.beginPath();
    ctx.moveTo(leftEdge, topEdge);

    // top edge
    if (top === 0) {
        ctx.lineTo(rightEdge, topEdge);
    } else {
        const dir = top;
        const centerX = padding + w / 2;
        const startX = centerX - radius;
        const endX = centerX + radius;
        ctx.lineTo(startX, topEdge);
        ctx.lineTo(startX, topEdge - neck * dir);
        ctx.arc(centerX, topEdge - neck * dir, radius, Math.PI, 0, dir === -1);
        ctx.lineTo(endX, topEdge - neck * dir);
        ctx.lineTo(endX, topEdge);
        ctx.lineTo(rightEdge, topEdge);
    }

    // right edge
    if (right === 0) {
        ctx.lineTo(rightEdge, bottomEdge);
    } else {
        const dir = right;
        const centerY = padding + h / 2;
        const startY = centerY - radius;
        const endY = centerY + radius;
        ctx.lineTo(rightEdge, startY);
        ctx.lineTo(rightEdge + neck * dir, startY);
        ctx.arc(rightEdge + neck * dir, centerY, radius, -Math.PI / 2, Math.PI / 2, dir === -1);
        ctx.lineTo(rightEdge + neck * dir, endY);
        ctx.lineTo(rightEdge, endY);
        ctx.lineTo(rightEdge, bottomEdge);
    }

    // bottom edge
    if (bottom === 0) {
        ctx.lineTo(leftEdge, bottomEdge);
    } else {
        const dir = bottom;
        const centerX = padding + w / 2;
        const startX = centerX + radius;
        const endX = centerX - radius;
        ctx.lineTo(startX, bottomEdge);
        ctx.lineTo(startX, bottomEdge + neck * dir);
        ctx.arc(centerX, bottomEdge + neck * dir, radius, 0, Math.PI, dir === -1);
        ctx.lineTo(endX, bottomEdge + neck * dir);
        ctx.lineTo(endX, bottomEdge);
        ctx.lineTo(leftEdge, bottomEdge);
    }

    // left edge
    if (left === 0) {
        ctx.lineTo(leftEdge, topEdge);
    } else {
        const dir = left;
        const centerY = padding + h / 2;
        const startY = centerY + radius;
        const endY = centerY - radius;
        ctx.lineTo(leftEdge, startY);
        ctx.lineTo(leftEdge - neck * dir, startY);
        ctx.arc(leftEdge - neck * dir, centerY, radius, Math.PI / 2, -Math.PI / 2, dir === -1);
        ctx.lineTo(leftEdge - neck * dir, endY);
        ctx.lineTo(leftEdge, endY);
        ctx.lineTo(leftEdge, topEdge);
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

function refreshPieceLockVisual(pieceId) {
    const piece = window.pieces[pieceId];
    if (!piece) {
        return;
    }
    const owner = window.lockedPieces.get(pieceId);
    if (owner && hubConnection && owner !== hubConnection.connectionId) {
        piece.classList.add('locked');
    } else {
        piece.classList.remove('locked');
    }
}

function refreshLockVisuals(pieceIds) {
    if (!Array.isArray(pieceIds)) {
        return;
    }
    pieceIds.forEach(refreshPieceLockVisual);
}

function makeDraggable(el, container) {
    let offsetX = 0, offsetY = 0, lastX = 0, lastY = 0;

    const startDrag = async (event) => {
        event.preventDefault();

        const rect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const touchPoint = event.touches ? event.touches[0] : null;
        const clientX = event.clientX ?? touchPoint?.clientX;
        const clientY = event.clientY ?? touchPoint?.clientY;
        if (clientX == null || clientY == null) {
            return;
        }

        offsetX = clientX - rect.left;
        offsetY = clientY - rect.top;
        lastX = parseFloat(el.style.left);
        lastY = parseFloat(el.style.top);
        const groupId = parseInt(el.dataset.groupId);
        const piecesToMove = window.pieces.filter(p => parseInt(p.dataset.groupId) === groupId);
        const pieceIds = piecesToMove
            .map(p => parseInt(p.dataset.pieceId))
            .filter(id => !Number.isNaN(id));

        const isLockedByOther = pieceIds.some(id => {
            const owner = window.lockedPieces.get(id);
            return owner && (!hubConnection || owner !== hubConnection.connectionId);
        });
        if (isLockedByOther) {
            return;
        }

        const lockAcquired = await requestPieceLock(pieceIds);
        if (!lockAcquired) {
            return;
        }

        if (hubConnection && hubConnection.connectionId) {
            pieceIds.forEach(id => {
                window.lockedPieces.set(id, hubConnection.connectionId);
            });
            refreshLockVisuals(pieceIds);
        }

        setGroupLayer(piecesToMove);

        piecesToMove.forEach(p => {
            locallyMovedPieces.add(parseInt(p.dataset.pieceId));
        });

        const onMove = (e) => {
            const moveTouch = e.touches ? e.touches[0] : null;
            const moveClientX = e.clientX ?? moveTouch?.clientX;
            const moveClientY = e.clientY ?? moveTouch?.clientY;
            if (moveClientX == null || moveClientY == null) {
                return;
            }

            const moveX = moveClientX - containerRect.left - offsetX;
            const moveY = moveClientY - containerRect.top - offsetY;
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
            document.removeEventListener('touchcancel', stop);
            piecesToMove.forEach(sendMove);
            piecesToMove.forEach(p => {
                locallyMovedPieces.delete(parseInt(p.dataset.pieceId));
            });
            snapPiece(el);
            releasePieceLock(pieceIds);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('touchmove', onMove);
        document.addEventListener('mouseup', stop);
        document.addEventListener('touchend', stop);
        document.addEventListener('touchcancel', stop);
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

                // Compare using the raw offsets so near-threshold pieces still connect.
                if (Math.abs(offsetX) < threshold && Math.abs(offsetY) < threshold) {
                    const neighborGroupId = parseInt(neighbor.dataset.groupId);

                    const neighborGroupPieces = window.pieces.filter(p => parseInt(p.dataset.groupId) === neighborGroupId);
                    const lockedByOther = neighborGroupPieces.some(p => {
                        const id = parseInt(p.dataset.pieceId);
                        if (Number.isNaN(id)) {
                            return false;
                        }
                        const owner = window.lockedPieces.get(id);
                        if (!owner) {
                            return false;
                        }
                        if (!hubConnection || !hubConnection.connectionId) {
                            return true;
                        }
                        return owner !== hubConnection.connectionId;
                    });

                    if (lockedByOther) {
                        continue;
                    }

                    const neighborOffsetX = parseFloat(neighbor.style.left) - parseFloat(neighbor.dataset.correctX);
                    const neighborOffsetY = parseFloat(neighbor.style.top) - parseFloat(neighbor.dataset.correctY);

                    neighborGroupPieces.forEach(p => {
                        p.dataset.groupId = groupId;
                    });

                    const finalGroup = window.pieces.filter(p => parseInt(p.dataset.groupId) === groupId);
                    setGroupLayer(finalGroup);
                    finalGroup.forEach(p => {
                        const targetX = Math.round(parseFloat(p.dataset.correctX) + neighborOffsetX);
                        const targetY = Math.round(parseFloat(p.dataset.correctY) + neighborOffsetY);
                        p.style.left = targetX + 'px';
                        p.style.top = targetY + 'px';
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

    if (response.ok) {
        return { success: true };
    }

    let error = 'Registration failed';
    try {
        const data = await response.json();
        if (typeof data === 'string') {
            error = data;
        } else if (data?.message) {
            error = data.message;
        } else if (Array.isArray(data?.errors) && data.errors.length > 0) {
            error = data.errors.join(' ');
        }
    } catch {
        // Ignore JSON parse errors and use the default message
    }

    return { success: false, error };
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

    if (response.ok) {
        return { success: true };
    }

    let error = 'Login failed';
    try {
        const data = await response.json();
        if (typeof data === 'string') {
            error = data;
        } else if (data?.message) {
            error = data.message;
        }
    } catch {
        // Ignore JSON parse errors and use the default message
    }

    return { success: false, error };
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
