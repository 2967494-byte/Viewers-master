import React, { useEffect, useMemo, useRef } from 'react';
import type { Raster } from './reconstruction';
import { applySharpness, createSharpeningDetail } from './sharpening';

export default function RasterView({
  raster,
  range,
  sharpness = 1,
  position,
  slicePosition,
  orientation,
  onPosition,
  label,
}: {
  raster: Raster;
  range: { lower: number; upper: number };
  sharpness?: number;
  position?: number;
  slicePosition?: number;
  orientation?: [string, string];
  onPosition?: (fraction: number, vertical: number) => void;
  label?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const startLabel = orientation?.[0],
    endLabel = orientation?.[1];
  const grayscale = useMemo(() => {
    if (!raster) return null;
    const values = new Uint8ClampedArray(raster.pixels.length);
    const scale = 255 / Math.max(1, range.upper - range.lower);
    for (let i = 0; i < values.length; i++) {
      values[i] = Number.isFinite(raster.pixels[i]) ? (raster.pixels[i] - range.lower) * scale : 0;
    }
    return values;
  }, [raster, range]);
  const sharpeningEnabled = sharpness > 1;
  const detail = useMemo(
    () =>
      grayscale && sharpeningEnabled
        ? createSharpeningDetail(grayscale, raster.width, raster.height)
        : null,
    [grayscale, raster, sharpeningEnabled]
  );
  const displayPixels = useMemo(
    () => (detail ? applySharpness(grayscale, detail, sharpness) : grayscale),
    [grayscale, detail, sharpness]
  );
  useEffect(() => {
    if (!raster || !ref.current) return;
    const { width, height } = raster;
    const canvas = ref.current;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(width, height);
    for (let i = 0; i < displayPixels.length; i++) {
      const value = displayPixels[i];
      image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = value;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    ctx.strokeStyle = '#fbbf24';
    ctx.fillStyle = '#fbbf24';
    ctx.lineWidth = 1;
    ctx.font = '11px sans-serif';
    if (startLabel && endLabel) {
      ctx.fillText(startLabel, 6, 13);
      ctx.textAlign = 'right';
      ctx.fillText(endLabel, width - 6, 13);
      ctx.textAlign = 'left';
    }
    const ruler = Math.min(20, raster.widthMm / 2);
    const rulerPx = (ruler / raster.widthMm) * (width - 1);
    ctx.beginPath();
    ctx.moveTo(8, height - 10);
    ctx.lineTo(8 + rulerPx, height - 10);
    ctx.stroke();
    ctx.fillText(`${ruler.toFixed(0)} мм`, 8, height - 15);
  }, [raster, displayPixels, startLabel, endLabel]);
  return (
    <div className="manual-raster-frame">
      <canvas
        ref={ref}
        className="manual-raster"
        aria-label={
          label || (onPosition ? 'Панорама: нажмите для выбора сечения' : 'Поперечное сечение')
        }
        onClick={event => {
          if (!onPosition || !raster) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const scale = Math.min(rect.width / raster.width, rect.height / raster.height);
          const left = (rect.width - raster.width * scale) / 2;
          const top = (rect.height - raster.height * scale) / 2;
          const x = (event.clientX - rect.left - left) / scale;
          const y = (event.clientY - rect.top - top) / scale;
          if (x >= 0 && x < raster.width && y >= 0 && y < raster.height)
            onPosition(x / (raster.width - 1), y / (raster.height - 1));
        }}
      />
      {raster && (
        <svg
          className="manual-raster-markers"
          viewBox={`0 0 ${raster.width} ${raster.height}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          {Number.isFinite(position) && position >= 0 && position <= 1 && (
            <line
              data-panorama-marker="vertical"
              x1={position * (raster.width - 1)}
              x2={position * (raster.width - 1)}
              y1="0"
              y2={raster.height}
              stroke="#fbbf24"
              strokeWidth="1.25"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {Number.isFinite(slicePosition) && slicePosition >= 0 && slicePosition <= 1 && (
            <line
              data-panorama-marker="horizontal"
              x1="0"
              x2={raster.width}
              y1={slicePosition * (raster.height - 1)}
              y2={slicePosition * (raster.height - 1)}
              stroke="#22c55e"
              strokeWidth="1.25"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      )}
    </div>
  );
}
