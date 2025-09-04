window.createPuzzle = function (imageDataUrl, containerId, pieceCount) {
    const img = new Image();
    img.onload = function () {
        let cols = Math.round(Math.sqrt(pieceCount));
        while (pieceCount % cols !== 0) {
            cols--;
        }
        const rows = pieceCount / cols;
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        container.classList.add('puzzle-container');

        // Scale the image so that it occupies 50% of the page width
        const targetWidth = window.innerWidth * 0.5;
        const scale = targetWidth / img.width;
        const scaledWidth = targetWidth;
        const scaledHeight = img.height * scale;

        const pieceWidth = scaledWidth / cols;
        const pieceHeight = scaledHeight / rows;
        const srcPieceWidth = img.width / cols;
        const srcPieceHeight = img.height / rows;
        const offset = Math.min(pieceWidth, pieceHeight) / 4;
        const srcOffset = offset / scale;

        container.style.width = scaledWidth + 'px';
        container.style.height = scaledHeight + 'px';

        const hTabs = Array.from({ length: rows }, () => Array(cols));
        const vTabs = Array.from({ length: rows }, () => Array(cols));

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

                // Randomize starting position to separate the pieces
                piece.style.left = Math.random() * (scaledWidth - pieceWidth) + 'px';
                piece.style.top = Math.random() * (scaledHeight - pieceHeight) + 'px';

                const ctx = piece.getContext('2d');
                drawPiecePath(ctx, pieceWidth, pieceHeight, top, right, bottom, left, offset);
                ctx.clip();
                ctx.drawImage(
                    img,
                    x * srcPieceWidth - srcOffset,
                    y * srcPieceHeight - srcOffset,
                    srcPieceWidth + srcOffset * 2,
                    srcPieceHeight + srcOffset * 2,
                    0,
                    0,
                    piece.width,
                    piece.height
                );
                ctx.stroke();
                container.appendChild(piece);
                makeDraggable(piece, container);
            }
        }
    };
    img.src = imageDataUrl;
};

function drawPiecePath(ctx, w, h, top, right, bottom, left, offset) {
    const tab = Math.min(w, h) / 4;
    ctx.beginPath();
    ctx.moveTo(offset, offset);

    // top edge
    if (top === 0) {
        ctx.lineTo(offset + w, offset);
    } else {
        ctx.lineTo(offset + w / 3, offset);
        ctx.bezierCurveTo(offset + w / 6, offset - tab * top, offset + w * 5 / 6, offset - tab * top, offset + w * 2 / 3, offset);
        ctx.lineTo(offset + w, offset);
    }

    // right edge
    if (right === 0) {
        ctx.lineTo(offset + w, offset + h);
    } else {
        ctx.lineTo(offset + w, offset + h / 3);
        ctx.bezierCurveTo(offset + w + tab * right, offset + h / 6, offset + w + tab * right, offset + h * 5 / 6, offset + w, offset + h * 2 / 3);
        ctx.lineTo(offset + w, offset + h);
    }

    // bottom edge
    if (bottom === 0) {
        ctx.lineTo(offset, offset + h);
    } else {
        ctx.lineTo(offset + w * 2 / 3, offset + h);
        ctx.bezierCurveTo(offset + w * 5 / 6, offset + h + tab * bottom, offset + w / 6, offset + h + tab * bottom, offset + w / 3, offset + h);
        ctx.lineTo(offset, offset + h);
    }

    // left edge
    if (left === 0) {
        ctx.lineTo(offset, offset);
    } else {
        ctx.lineTo(offset, offset + h * 2 / 3);
        ctx.bezierCurveTo(offset - tab * left, offset + h * 5 / 6, offset - tab * left, offset + h / 6, offset, offset + h / 3);
        ctx.lineTo(offset, offset);
    }

    ctx.closePath();
}

function makeDraggable(el, container) {
    let offsetX = 0, offsetY = 0;

    const startDrag = (event) => {
        event.preventDefault();
        const rect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const clientX = event.clientX ?? event.touches[0].clientX;
        const clientY = event.clientY ?? event.touches[0].clientY;
        offsetX = clientX - rect.left;
        offsetY = clientY - rect.top;

        const onMove = (e) => {
            const moveX = (e.clientX ?? e.touches[0].clientX) - containerRect.left - offsetX;
            const moveY = (e.clientY ?? e.touches[0].clientY) - containerRect.top - offsetY;
            el.style.left = moveX + 'px';
            el.style.top = moveY + 'px';
        };

        const stop = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('mouseup', stop);
            document.removeEventListener('touchend', stop);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('touchmove', onMove);
        document.addEventListener('mouseup', stop);
        document.addEventListener('touchend', stop);
    };

    el.addEventListener('mousedown', startDrag);
    el.addEventListener('touchstart', startDrag);
}
