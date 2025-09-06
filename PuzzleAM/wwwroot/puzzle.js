window.pieces = [];
// Track the highest z-index so groups can be brought to the front
window.maxZ = 1;
let hubConnection;
let currentRoomCode = null;
const locallyMovedPieces = new Set();

// Load audio assets for various game events
const sounds = {
    start: new Audio('/audio/Start.wav'),
    connect: new Audio('/audio/Connect.wav'),
    applause: new Audio('/audio/Applause.wav')
};

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

function startHubConnection() {
    hubConnection = new signalR.HubConnectionBuilder()
        .withUrl("/puzzlehub")
        .withAutomaticReconnect()
        .build();

    window.puzzleHub = hubConnection;

    hubConnection.on("PieceMoved", data => {
        if (locallyMovedPieces.has(data.id)) {
            return;
        }

        const piece = window.pieces[data.id];
        if (piece) {
            if (typeof window.boardLeft === 'number' && typeof window.boardWidth === 'number') {
                piece.style.left = (window.boardLeft + data.left * window.boardWidth) + "px";
                piece.style.top = (window.boardTop + data.top * window.boardHeight) + "px";
            } else {
                piece.style.left = data.left + "px";
                piece.style.top = data.top + "px";
            }
            if (data.groupId != null) {
                piece.dataset.groupId = data.groupId;
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

    hubConnection.start().catch(err => console.error(err));
}

function sendMove(piece) {
    if (hubConnection && hubConnection.state === signalR.HubConnectionState.Connected &&
        typeof window.boardLeft === 'number' && typeof window.boardWidth === 'number') {
        const payload = {
            id: parseInt(piece.dataset.pieceId),
            left: (parseFloat(piece.style.left) - window.boardLeft) / window.boardWidth,
            top: (parseFloat(piece.style.top) - window.boardTop) / window.boardHeight
        };
        const groupId = parseInt(piece.dataset.groupId);
        if (Number.isFinite(groupId)) {
            payload.groupId = groupId;
        }
        hubConnection.invoke("MovePiece", currentRoomCode, payload).catch(err => console.error(err));
    }
}

window.addEventListener("load", startHubConnection);

window.setRoomCode = function (code) {
    currentRoomCode = code;
};

window.createRoom = async function (imageDataUrl, pieceCount) {
    if (hubConnection && hubConnection.state === signalR.HubConnectionState.Connected) {
        const code = await hubConnection.invoke("CreateRoom", imageDataUrl || "", pieceCount || 0);
        window.setRoomCode(code);
        return code;
    }
    return null;
};

window.setPuzzle = async function (roomCode, imageDataUrl, pieceCount) {
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
    if (hubConnection && hubConnection.state === signalR.HubConnectionState.Connected) {
        const state = await hubConnection.invoke("JoinRoom", roomCode);
        if (state) {
            window.setRoomCode(roomCode);
        }
        return state;
    }
    return null;
};

window.leaveRoom = async function () {
    if (hubConnection && hubConnection.state === signalR.HubConnectionState.Connected && currentRoomCode) {
        await hubConnection.invoke("LeaveRoom", currentRoomCode);
        currentRoomCode = null;
    }
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
    const img = new Image();
    img.onload = function () {
        const rows = layout.rows;
        const cols = layout.columns;
        const piecesLayout = layout.pieces || [];
        const pieceMap = {};
        piecesLayout.forEach(p => pieceMap[p.id] = p);

        const container = document.getElementById(containerId);
        container.classList.add('puzzle-container');
        container.innerHTML = '';

        const containerRect = container.getBoundingClientRect();
        const availableWidth = window.innerWidth - containerRect.left;
        const availableHeight = window.innerHeight - containerRect.top;

        const widthFactor = window.innerWidth <= 768 ? 0.9 : 0.5;
        const heightFactor = window.innerWidth <= 768 ? 0.6 : 0.5;
        const targetWidth = availableWidth * widthFactor;
        const targetHeight = availableHeight * heightFactor;
        const scale = Math.min(targetWidth / img.width, targetHeight / img.height);
        const scaledWidth = img.width * scale;
        const scaledHeight = img.height * scale;

        const pieceWidth = scaledWidth / cols;
        const pieceHeight = scaledHeight / rows;
        const srcPieceWidth = img.width / cols;
        const srcPieceHeight = img.height / rows;
        const offset = Math.min(pieceWidth, pieceHeight) / 4;
        const srcOffsetX = offset / scale;
        const srcOffsetY = offset / scale;

        container.style.width = availableWidth + 'px';
        container.style.height = availableHeight + 'px';

        const boardLeft = (availableWidth - scaledWidth) / 2;
        const boardTop = (availableHeight - scaledHeight) / 2;

        const board = document.createElement('div');
        board.classList.add('puzzle-board');
        board.style.left = boardLeft + 'px';
        board.style.top = boardTop + 'px';
        board.style.width = scaledWidth + 'px';
        board.style.height = scaledHeight + 'px';
        container.appendChild(board);

        window.puzzleRows = rows;
        window.puzzleCols = cols;
        window.boardLeft = boardLeft;
        window.boardTop = boardTop;
        window.boardWidth = scaledWidth;
        window.boardHeight = scaledHeight;

        const hTabs = Array.from({ length: rows }, () => Array(cols));
        const vTabs = Array.from({ length: rows }, () => Array(cols));

        window.pieces = [];

        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
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
                piece.style.left = boardLeft + p.left * scaledWidth + 'px';
                piece.style.top = boardTop + p.top * scaledHeight + 'px';

                const correctX = boardLeft + x * pieceWidth - offset;
                const correctY = boardTop + y * pieceHeight - offset;
                piece.dataset.correctX = correctX;
                piece.dataset.correctY = correctY;
                piece.dataset.width = pieceWidth;
                piece.dataset.height = pieceHeight;
                piece.dataset.groupId = p.groupId !== undefined ? p.groupId : pieceIndex;
                piece.dataset.pieceId = pieceIndex;
                piece.dataset.row = y;
                piece.dataset.col = x;

                const ctx = piece.getContext('2d');
                ctx.clearRect(0, 0, piece.width, piece.height);
                ctx.save();
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
                container.appendChild(piece);
                window.pieces.push(piece);
                makeDraggable(piece, container);
            }
        }
        updateAllShadows();
        playStartSound();
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
        ctx.arc(offset + w + neck * dir, centerY, radius, Math.PI / 2, -Math.PI / 2, dir === 1);
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

// Precompute drop-shadow filter combinations to minimize dynamic string creation
const baseShadows = [
    'drop-shadow(0 -3px 6px rgba(0, 0, 0, 0.5))', // top
    'drop-shadow(-3px 0 6px rgba(0, 0, 0, 0.5))', // left
    'drop-shadow(0 3px 6px rgba(0, 0, 0, 0.5))', // bottom
    'drop-shadow(3px 0 6px rgba(0, 0, 0, 0.5))'  // right
];
const shadowCache = Array(16).fill('none');
for (let i = 1; i < 16; i++) {
    const parts = [];
    if (i & 1) parts.push(baseShadows[0]);
    if (i & 2) parts.push(baseShadows[1]);
    if (i & 4) parts.push(baseShadows[2]);
    if (i & 8) parts.push(baseShadows[3]);
    shadowCache[i] = parts.join(' ');
}

function updatePieceShadow(piece) {
    const groupId = parseInt(piece.dataset.groupId);
    const row = parseInt(piece.dataset.row);
    const col = parseInt(piece.dataset.col);

    let mask = 0;

    const topNeighbor = row > 0 ? window.pieces[(row - 1) * window.puzzleCols + col] : null;
    if (!(topNeighbor && parseInt(topNeighbor.dataset.groupId) === groupId)) {
        mask |= 1;
    }

    const leftNeighbor = col > 0 ? window.pieces[row * window.puzzleCols + (col - 1)] : null;
    if (!(leftNeighbor && parseInt(leftNeighbor.dataset.groupId) === groupId)) {
        mask |= 2;
    }

    const bottomNeighbor = row < window.puzzleRows - 1 ? window.pieces[(row + 1) * window.puzzleCols + col] : null;
    if (!(bottomNeighbor && parseInt(bottomNeighbor.dataset.groupId) === groupId)) {
        mask |= 4;
    }

    const rightNeighbor = col < window.puzzleCols - 1 ? window.pieces[row * window.puzzleCols + (col + 1)] : null;
    if (!(rightNeighbor && parseInt(rightNeighbor.dataset.groupId) === groupId)) {
        mask |= 8;
    }

    if (piece.dataset.shadowMask != mask) {
        piece.dataset.shadowMask = mask;
        piece.style.filter = shadowCache[mask];
    }
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
            const dx = moveX - lastX;
            const dy = moveY - lastY;

            piecesToMove.forEach(p => {
                p.style.left = (parseFloat(p.style.left) + dx) + 'px';
                p.style.top = (parseFloat(p.style.top) + dy) + 'px';
                sendMove(p);
            });

            lastX = moveX;
            lastY = moveY;
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

function snapPiece(el) {
    const threshold = 15;
    const groupId = parseInt(el.dataset.groupId);
    const groupPieces = window.pieces.filter(p => parseInt(p.dataset.groupId) === groupId);
    const epsilon = 0.1;

    /*
    // Snap to correct location if the dragged piece is close
    const correctX = parseFloat(el.dataset.correctX);
    const correctY = parseFloat(el.dataset.correctY);
    const currentX = parseFloat(el.style.left);
    const currentY = parseFloat(el.style.top);
    const diffCorrectX = correctX - currentX;
    const diffCorrectY = correctY - currentY;
    if (Math.abs(diffCorrectX) < threshold && Math.abs(diffCorrectY) < threshold) {
        groupPieces.forEach(p => {
            p.style.left = (parseFloat(p.style.left) + diffCorrectX) + 'px';
            p.style.top = (parseFloat(p.style.top) + diffCorrectY) + 'px';
            sendMove(p);
        });
        updateAllShadows();
        checkCompletion();
        return;
    }
    */

    // Check all pieces in the group for connections to other groups
    for (const piece of groupPieces) {
        const pieceCorrectX = parseFloat(piece.dataset.correctX);
        const pieceCorrectY = parseFloat(piece.dataset.correctY);
        const pieceCurrentX = parseFloat(piece.style.left);
        const pieceCurrentY = parseFloat(piece.style.top);
        const pieceWidth = parseFloat(piece.dataset.width);
        const pieceHeight = parseFloat(piece.dataset.height);

        for (const neighbor of window.pieces) {
            if (parseInt(neighbor.dataset.groupId) === groupId) continue;

            const expectedDx = parseFloat(neighbor.dataset.correctX) - pieceCorrectX;
            const expectedDy = parseFloat(neighbor.dataset.correctY) - pieceCorrectY;

            const isHorizontalNeighbor = Math.abs(Math.abs(expectedDx) - pieceWidth) < epsilon && Math.abs(expectedDy) < epsilon;
            const isVerticalNeighbor = Math.abs(Math.abs(expectedDy) - pieceHeight) < epsilon && Math.abs(expectedDx) < epsilon;
            if (!isHorizontalNeighbor && !isVerticalNeighbor) continue;

            const actualDx = parseFloat(neighbor.style.left) - pieceCurrentX;
            const actualDy = parseFloat(neighbor.style.top) - pieceCurrentY;
            const diffX = actualDx - expectedDx;
            const diffY = actualDy - expectedDy;

            if (Math.abs(diffX) < threshold && Math.abs(diffY) < threshold) {
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
                finalGroup.forEach(sendMove);
                playConnectSound();
                updateAllShadows();
                checkCompletion();
                return;
            }
        }
    }

    updateAllShadows();
    checkCompletion();
}

function checkCompletion() {
    if (window.pieces.length === 0) return;
    const groupId = window.pieces[0].dataset.groupId;
    const solved = window.pieces.every(p => p.dataset.groupId === groupId);
    if (solved) {
        console.log('Puzzle completed!');
        playApplauseSound();
    }
}
