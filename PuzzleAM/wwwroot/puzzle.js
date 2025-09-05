window.pieces = [];
// Track the highest z-index so groups can be brought to the front
window.maxZ = 1;
let hubConnection;

function startHubConnection() {
    hubConnection = new signalR.HubConnectionBuilder()
        .withUrl("/puzzleHub")
        .withAutomaticReconnect()
        .build();

    window.puzzleHub = hubConnection;

    hubConnection.on("PieceMoved", data => {
        const piece = window.pieces[data.id];
        if (piece) {
            piece.style.left = data.left + "px";
            piece.style.top = data.top + "px";
            if (data.groupId !== undefined) {
                piece.dataset.groupId = data.groupId;
            }
            updatePieceShadow(piece);
        }
    });

    hubConnection.on("BoardState", state => {
        if (state.imageDataUrl && window.pieces.length === 0) {
            window.createPuzzle(state.imageDataUrl, "puzzleContainer", state.pieces.length);
        }

        (state.pieces || []).forEach(p => {
            const piece = window.pieces[p.id];
            if (piece) {
                piece.style.left = p.left + "px";
                piece.style.top = p.top + "px";
                if (p.groupId !== undefined) {
                    piece.dataset.groupId = p.groupId;
                }
                updatePieceShadow(piece);
            }
        });
    });

    hubConnection.start().catch(err => console.error(err));
}

function sendMove(piece) {
    if (hubConnection && hubConnection.state === signalR.HubConnectionState.Connected) {
        hubConnection.invoke("MovePiece", {
            id: parseInt(piece.dataset.pieceId),
            left: parseFloat(piece.style.left),
            top: parseFloat(piece.style.top),
            groupId: parseInt(piece.dataset.groupId)
        }).catch(err => console.error(err));
    }
}

window.addEventListener("load", startHubConnection);

window.setBackgroundColor = function (color) {
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
};

window.createPuzzle = function (imageDataUrl, containerId, pieceCount) {
    const img = new Image();
    img.onload = function () {
        // Determine a grid that keeps rows and columns as balanced as possible
        let rows = Math.floor(Math.sqrt(pieceCount));
        while (rows > 1 && pieceCount % rows !== 0) {
            rows--;
        }
        let cols;
        if (rows > 1 && pieceCount % rows === 0) {
            cols = pieceCount / rows;
        } else {
            // Fallback for prime counts – approximate a square grid
            rows = Math.floor(Math.sqrt(pieceCount));
            cols = Math.ceil(pieceCount / rows);
        }

        const container = document.getElementById(containerId);
        container.classList.add('puzzle-container');

        // Clear any existing puzzle elements
        container.innerHTML = '';

        // Determine the available area for the puzzle based on where the
        // container sits within the page layout. This ensures the puzzle fits
        // entirely within the visible browser window even when there are
        // headers, sidebars or other elements taking up space.
        const containerRect = container.getBoundingClientRect();
        const availableWidth = window.innerWidth - containerRect.left;
        const availableHeight = window.innerHeight - containerRect.top;

        // Constrain the puzzle to half of the available viewport space in each
        // dimension
        const targetWidth = availableWidth * 0.5;
        const targetHeight = availableHeight * 0.5;
        const pieceSize = Math.min(targetWidth / cols, targetHeight / rows);
        const scaledWidth = pieceSize * cols;
        const scaledHeight = pieceSize * rows;
        const scaleX = scaledWidth / img.width;
        const scaleY = scaledHeight / img.height;

        const pieceWidth = pieceSize;
        const pieceHeight = pieceSize;
        const srcPieceWidth = img.width / cols;
        const srcPieceHeight = img.height / rows;
        const offset = pieceSize / 4;
        const srcOffsetX = offset / scaleX;
        const srcOffsetY = offset / scaleY;

        // Size the container to the available area so pieces remain within the
        // viewport without causing scroll bars
        container.style.width = availableWidth + 'px';
        container.style.height = availableHeight + 'px';

        // Centre point for where the puzzle should be assembled
        const boardLeft = (availableWidth - scaledWidth) / 2;
        const boardTop = (availableHeight - scaledHeight) / 2;

        const buffer = pieceSize; // leave one piece size around the puzzle
        const centralRect = {
            left: boardLeft - buffer,
            top: boardTop - buffer,
            right: boardLeft + scaledWidth + buffer,
            bottom: boardTop + scaledHeight + buffer
        };

        const board = document.createElement('div');
        board.classList.add('puzzle-board');
        board.style.left = boardLeft + 'px';
        board.style.top = boardTop + 'px';
        board.style.width = scaledWidth + 'px';
        board.style.height = scaledHeight + 'px';
        container.appendChild(board);

        const placedRects = [];

        // expose puzzle dimensions for later neighbor checks
        window.puzzleRows = rows;
        window.puzzleCols = cols;

        const hTabs = Array.from({ length: rows }, () => Array(cols));
        const vTabs = Array.from({ length: rows }, () => Array(cols));

        // reset pieces for new puzzle
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

                // Find a random starting position around the edges without overlapping others
                let startX, startY, attempts = 0;
                do {
                    attempts++;
                    const side = ['top', 'bottom', 'left', 'right'][Math.floor(Math.random() * 4)];
                    if (side === 'top') {
                        startX = Math.random() * Math.max(availableWidth - piece.width, 0);
                        startY = Math.random() * Math.max(centralRect.top - piece.height, 0);
                    } else if (side === 'bottom') {
                        startX = Math.random() * Math.max(availableWidth - piece.width, 0);
                        startY = centralRect.bottom + Math.random() * Math.max(availableHeight - centralRect.bottom - piece.height, 0);
                    } else if (side === 'left') {
                        startX = Math.random() * Math.max(centralRect.left - piece.width, 0);
                        startY = Math.random() * Math.max(availableHeight - piece.height, 0);
                    } else { // right
                        startX = centralRect.right + Math.random() * Math.max(availableWidth - centralRect.right - piece.width, 0);
                        startY = Math.random() * Math.max(availableHeight - piece.height, 0);
                    }
                } while (
                    placedRects.some(r => startX < r.x + r.width && startX + piece.width > r.x &&
                        startY < r.y + r.height && startY + piece.height > r.y) && attempts < 1000
                );

                placedRects.push({ x: startX, y: startY, width: piece.width, height: piece.height });

                piece.style.left = startX + 'px';
                piece.style.top = startY + 'px';

                // Store the correct coordinates for snapping
                const correctX = boardLeft + x * pieceWidth - offset;
                const correctY = boardTop + y * pieceHeight - offset;
                piece.dataset.correctX = correctX;
                piece.dataset.correctY = correctY;
                piece.dataset.width = pieceWidth;
                piece.dataset.height = pieceHeight;
                piece.dataset.groupId = window.pieces.length;
                piece.dataset.pieceId = window.pieces.length;
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

function updatePieceShadow(piece) {
    const groupId = parseInt(piece.dataset.groupId);
    const row = parseInt(piece.dataset.row);
    const col = parseInt(piece.dataset.col);
    const neighbors = [];
    if (row > 0) neighbors.push(window.pieces[(row - 1) * window.puzzleCols + col]);
    if (row < window.puzzleRows - 1) neighbors.push(window.pieces[(row + 1) * window.puzzleCols + col]);
    if (col > 0) neighbors.push(window.pieces[row * window.puzzleCols + (col - 1)]);
    if (col < window.puzzleCols - 1) neighbors.push(window.pieces[row * window.puzzleCols + (col + 1)]);
    const complete = neighbors.every(n => n && parseInt(n.dataset.groupId) === groupId);
    piece.style.filter = complete ? 'none' : '';
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

    // Check all pieces in the group for connections to other groups
    for (const piece of groupPieces) {
        const pieceCorrectX = parseFloat(piece.dataset.correctX);
        const pieceCorrectY = parseFloat(piece.dataset.correctY);
        const pieceCurrentX = parseFloat(piece.style.left);
        const pieceCurrentY = parseFloat(piece.style.top);
        const pieceWidth = parseFloat(piece.dataset.width);
        const pieceHeight = parseFloat(piece.dataset.height);

        for (const neighbor of window.pieces) {
            if (neighbor.dataset.groupId === groupId) continue;

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

                updateAllShadows();
                checkCompletion();
                return;
            }
        }
    }
}

function checkCompletion() {
    if (window.pieces.length === 0) return;
    const groupId = window.pieces[0].dataset.groupId;
    const solved = window.pieces.every(p => p.dataset.groupId === groupId);
    if (solved) {
        console.log('Puzzle completed!');
    }
}
