import React, { useEffect, useMemo, useRef } from 'react';
import type { Raster } from './reconstruction';
import { applySharpness, createSharpeningDetail } from './sharpening';
import { ORBITAL_MPR_COLORS, ORBITAL_OVERLAY_COLOR } from '@ohif/core/src/constants/orbitalTheme';
import { panoramaRasterPosition } from './panoramaNavigation';
import useAxesVisibility from '@ohif/core/src/hooks/useAxesVisibility';
import { useRasterImageFilter as useImageFilter } from '@ohif/core/src/hooks/useImageFilter';
import { filterImagePixels } from '@ohif/core/src/constants/orbitalImageFilters';

export default function RasterView({
  raster,
  range,
  sharpness = 1,
  position,
  slicePosition,
  sectionPath,
  orientation,
  onPosition,
  dragToPosition = false,
  label,
  overlay,
  axesVisible: axesOverride,
}: {
  raster: Raster;
  range: { lower: number; upper: number };
  sharpness?: number;
  position?: number;
  slicePosition?: number;
  sectionPath?: string;
  orientation?: [string, string];
  onPosition?: (fraction: number, vertical: number) => void;
  dragToPosition?: boolean;
  label?: string;
  overlay?: React.ReactNode;
  axesVisible?: boolean;
}) {
  const globalAxesVisible = useAxesVisibility();
  const axesVisible = axesOverride ?? globalAxesVisible;
  const imageFilter = useImageFilter();
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<number>(null);
  const frame = useRef(0);
  const pending = useRef<[number, number]>(null);
  const positionCallback = useRef(onPosition);
  positionCallback.current = onPosition;
  const cancelDrag = () => {
    drag.current = null;
    pending.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
  };
  useEffect(() => {
    cancelDrag();
    return cancelDrag;
  }, [raster, dragToPosition, !!onPosition]);
  const flushPosition = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    const point = pending.current;
    pending.current = null;
    if (point) positionCallback.current?.(...point);
  };
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
    () => {
      const pixels = detail ? applySharpness(grayscale, detail, sharpness) : grayscale;
      return pixels ? filterImagePixels(pixels, raster.width, raster.height, imageFilter) : null;
    },
    [grayscale, detail, sharpness, raster, imageFilter]
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
    ctx.strokeStyle = ORBITAL_OVERLAY_COLOR;
    ctx.fillStyle = ORBITAL_OVERLAY_COLOR;
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
        title={
          dragToPosition && onPosition
            ? 'Щёлкните или ведите с нажатой левой кнопкой — область появится на трёх срезах'
            : undefined
        }
        style={
          dragToPosition && onPosition ? { touchAction: 'none', cursor: 'crosshair' } : undefined
        }
        onPointerDown={event => {
          if (
            !dragToPosition ||
            !onPosition ||
            event.button !== 0 ||
            !event.isPrimary ||
            event.ctrlKey ||
            event.altKey ||
            event.metaKey ||
            event.shiftKey
          )
            return;
          const point = panoramaRasterPosition(
            event.currentTarget.getBoundingClientRect(),
            raster,
            event.clientX,
            event.clientY
          );
          if (!point) return;
          event.preventDefault();
          event.stopPropagation();
          drag.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          positionCallback.current?.(...point);
        }}
        onPointerMove={event => {
          if (drag.current !== event.pointerId) return;
          event.preventDefault();
          event.stopPropagation();
          if (!(event.buttons & 1)) return cancelDrag();
          pending.current = panoramaRasterPosition(
            event.currentTarget.getBoundingClientRect(),
            raster,
            event.clientX,
            event.clientY,
            true
          );
          if (!frame.current) frame.current = requestAnimationFrame(flushPosition);
        }}
        onPointerUp={event => {
          if (drag.current !== event.pointerId) return;
          event.preventDefault();
          event.stopPropagation();
          pending.current = panoramaRasterPosition(
            event.currentTarget.getBoundingClientRect(),
            raster,
            event.clientX,
            event.clientY,
            true
          );
          flushPosition();
          cancelDrag();
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={cancelDrag}
        onLostPointerCapture={cancelDrag}
        onClick={event => {
          if (!onPosition || !raster) return;
          if (dragToPosition) {
            event.stopPropagation();
            return;
          }
          const point = panoramaRasterPosition(
            event.currentTarget.getBoundingClientRect(),
            raster,
            event.clientX,
            event.clientY
          );
          if (point) onPosition(...point);
        }}
      />
      {raster && (
        <svg
          className="manual-raster-markers"
          viewBox={`0 0 ${raster.width} ${raster.height}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          {overlay}
          {axesVisible && sectionPath !== undefined && <path data-panorama-marker="tilted-section" d={sectionPath} fill="none" stroke={ORBITAL_MPR_COLORS.sagittal} strokeWidth="1.25" vectorEffect="non-scaling-stroke" />}
          {axesVisible && sectionPath === undefined && Number.isFinite(position) && position >= 0 && position <= 1 && (
            <line
              data-panorama-marker="vertical"
              x1={position * (raster.width - 1)}
              x2={position * (raster.width - 1)}
              y1="0"
              y2={raster.height}
              stroke={ORBITAL_MPR_COLORS.sagittal}
              strokeWidth="1.25"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {axesVisible && Number.isFinite(slicePosition) && slicePosition >= 0 && slicePosition <= 1 && (
            <line
              data-panorama-marker="horizontal"
              x1="0"
              x2={raster.width}
              y1={slicePosition * (raster.height - 1)}
              y2={slicePosition * (raster.height - 1)}
              stroke={ORBITAL_MPR_COLORS.axial}
              strokeWidth="1.25"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      )}
    </div>
  );
}
