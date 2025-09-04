window.pieces = [];

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

        // Constrain the puzzle to half the viewport in each dimension
        const targetWidth = window.innerWidth * 0.5;
        const targetHeight = window.innerHeight * 0.5;
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

        // Make the container full screen so pieces can sit around the board
        container.style.width = window.innerWidth + 'px';
        container.style.height = window.innerHeight + 'px';

        // Centre point for where the puzzle should be assembled
        const boardLeft = (window.innerWidth - scaledWidth) / 2;
        const boardTop = (window.innerHeight - scaledHeight) / 2;

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
                        startX = Math.random() * (window.innerWidth - piece.width);
                        startY = Math.random() * (centralRect.top - piece.height);
                    } else if (side === 'bottom') {
                        startX = Math.random() * (window.innerWidth - piece.width);
                        startY = centralRect.bottom + Math.random() * (window.innerHeight - centralRect.bottom - piece.height);
                    } else if (side === 'left') {
                        startX = Math.random() * (centralRect.left - piece.width);
                        startY = Math.random() * (window.innerHeight - piece.height);
                    } else { // right
                        startX = centralRect.right + Math.random() * (window.innerWidth - centralRect.right - piece.width);
                        startY = Math.random() * (window.innerHeight - piece.height);
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

                const ctx = piece.getContext('2d');
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
                ctx.stroke();
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
        const groupId = el.dataset.groupId;

        const onMove = (e) => {
            const moveX = (e.clientX ?? e.touches[0].clientX) - containerRect.left - offsetX;
            const moveY = (e.clientY ?? e.touches[0].clientY) - containerRect.top - offsetY;
            const dx = moveX - lastX;
            const dy = moveY - lastY;

            window.pieces.forEach(p => {
                if (p.dataset.groupId === groupId) {
                    p.style.left = (parseFloat(p.style.left) + dx) + 'px';
                    p.style.top = (parseFloat(p.style.top) + dy) + 'px';
                }
            });

            lastX = moveX;
            lastY = moveY;
        };

        const stop = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('mouseup', stop);
            document.removeEventListener('touchend', stop);
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
    const groupId = el.dataset.groupId;
    const groupPieces = window.pieces.filter(p => p.dataset.groupId === groupId);

    const correctX = parseFloat(el.dataset.correctX);
    const correctY = parseFloat(el.dataset.correctY);
    const currentX = parseFloat(el.style.left);
    const currentY = parseFloat(el.style.top);
    const pieceWidth = parseFloat(el.dataset.width);
    const pieceHeight = parseFloat(el.dataset.height);
    const epsilon = 0.1;

    // Snap to correct location if close
    const diffCorrectX = correctX - currentX;
    const diffCorrectY = correctY - currentY;
    if (Math.abs(diffCorrectX) < threshold && Math.abs(diffCorrectY) < threshold) {
        groupPieces.forEach(p => {
            p.style.left = (parseFloat(p.style.left) + diffCorrectX) + 'px';
            p.style.top = (parseFloat(p.style.top) + diffCorrectY) + 'px';
        });
        checkCompletion();
        return;
    }

    for (const neighbor of window.pieces) {
        if (neighbor.dataset.groupId === groupId) continue;

        const expectedDx = parseFloat(neighbor.dataset.correctX) - correctX;
        const expectedDy = parseFloat(neighbor.dataset.correctY) - correctY;

        const isHorizontalNeighbor = Math.abs(Math.abs(expectedDx) - pieceWidth) < epsilon && Math.abs(expectedDy) < epsilon;
        const isVerticalNeighbor = Math.abs(Math.abs(expectedDy) - pieceHeight) < epsilon && Math.abs(expectedDx) < epsilon;
        if (!isHorizontalNeighbor && !isVerticalNeighbor) continue;

        const actualDx = parseFloat(neighbor.style.left) - currentX;
        const actualDy = parseFloat(neighbor.style.top) - currentY;
        const diffX = actualDx - expectedDx;
        const diffY = actualDy - expectedDy;

        if (Math.abs(diffX) < threshold && Math.abs(diffY) < threshold) {
            groupPieces.forEach(p => {
                p.style.left = (parseFloat(p.style.left) + diffX) + 'px';
                p.style.top = (parseFloat(p.style.top) + diffY) + 'px';
            });

            const neighborGroupId = neighbor.dataset.groupId;
            window.pieces.forEach(p => {
                if (p.dataset.groupId === neighborGroupId) {
                    p.dataset.groupId = groupId;
                }
            });

            checkCompletion();
            break;
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
