if (typeof registerPaint !== 'undefined') {
    class SmoothCornersPainterFigmaLike {
        static get inputProperties() {
            return [
                '--corner-radius',
                '--painter-background-color',
                '--painter-border-color',
                '--painter-border-width',
                '--corner-smoothing-factor', // Новая переменная
            ];
        }

        paint(ctx, geom, properties) {
            const cornerRadius = parseFloat(properties.get('--corner-radius')?.toString() || '15'); // Используем 12px по умолчанию из предыдущего шага
            const backgroundColor = properties.get('--painter-background-color')?.toString() || 'transparent';
            const borderColor = properties.get('--painter-border-color')?.toString() || 'transparent';
            const borderWidth = parseFloat(properties.get('--painter-border-width')?.toString() || '0');
            const smoothingFactor = parseFloat(properties.get('--corner-smoothing-factor')?.toString() || '0.6'); // 0.6 для "60% эффекта"

            const width = geom.width;
            const height = geom.height;

            if (width <= 0 || height <= 0) {
                return;
            }

            // kappa для круговой дуги
            const baseKappa = 0.5522847498307936; // 4 * (Math.sqrt(2) - 1) / 3
            // Максимальное "вытягивание" контрольных точек для самого гладкого угла. 
            // Это значение можно подбирать. 0.3 дает заметный эффект.
            const kappaRange = 0.3; 
            const effectiveKappa = baseKappa + (kappaRange * smoothingFactor);


            const drawPathWithSmoothCorners = (currentCtx, x, y, w, h, r, k) => {
                r = Math.min(r, w / 2, h / 2);
                if (r < 0) r = 0;

                currentCtx.beginPath();
                // Top-left corner
                currentCtx.moveTo(x + r, y);
                // Top edge
                currentCtx.lineTo(x + w - r, y);
                // Top-right corner
                currentCtx.bezierCurveTo(
                    x + w - r + r * k, y, // CP1
                    x + w, y + r - r * k, // CP2
                    x + w, y + r          // End point
                );
                // Right edge
                currentCtx.lineTo(x + w, y + h - r);
                // Bottom-right corner
                currentCtx.bezierCurveTo(
                    x + w, y + h - r + r * k, // CP1
                    x + w - r + r * k, y + h, // CP2
                    x + w - r, y + h          // End point
                );
                // Bottom edge
                currentCtx.lineTo(x + r, y + h);
                // Bottom-left corner
                currentCtx.bezierCurveTo(
                    x + r - r * k, y + h, // CP1
                    x, y + h - r + r * k, // CP2
                    x, y + h - r          // End point
                );
                // Left edge
                currentCtx.lineTo(x, y + r);
                // Top-left corner (finish)
                currentCtx.bezierCurveTo(
                    x, y + r - r * k,     // CP1
                    x + r - r * k, y,     // CP2
                    x + r, y              // End point
                );
                currentCtx.closePath();
            };

            // 1. Draw border if borderWidth > 0
            if (borderWidth > 0 && borderColor !== 'transparent') {
                ctx.fillStyle = borderColor;
                drawPathWithSmoothCorners(ctx, 0, 0, width, height, cornerRadius, effectiveKappa);
                ctx.fill();
            }

            // 2. Draw background (inset from border)
            if (backgroundColor !== 'transparent') {
                const bgX = borderWidth;
                const bgY = borderWidth;
                const bgWidth = Math.max(0, width - 2 * borderWidth);
                const bgHeight = Math.max(0, height - 2 * borderWidth);
                
                let bgRadius = Math.max(0, cornerRadius - borderWidth);
                bgRadius = Math.min(bgRadius, bgWidth / 2, bgHeight / 2);
                if (bgRadius < 0) bgRadius = 0;

                if (bgWidth > 0 && bgHeight > 0) {
                    ctx.fillStyle = backgroundColor;
                    // Используем тот же effectiveKappa для фона, чтобы кривизна была консистентной
                    drawPathWithSmoothCorners(ctx, bgX, bgY, bgWidth, bgHeight, bgRadius, effectiveKappa);
                    ctx.fill();
                }
            }
        }
    }

    try {
        // Убедимся, что регистрируем под тем же именем, которое используется в CSS
        registerPaint('smooth-corners', SmoothCornersPainterFigmaLike);
    } catch (e) {
        // console.error('Failed to register SmoothCornersPainterFigmaLike:', e);
    }
} else {
    // console.warn('CSS Paint API (registerPaint) is not supported in this browser.');
}