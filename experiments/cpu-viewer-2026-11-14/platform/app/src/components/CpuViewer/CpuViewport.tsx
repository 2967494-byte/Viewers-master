import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ORBITAL_MPR_COLORS } from '@ohif/core/src/constants/orbitalTheme';
import type { Point3 } from '../../../../../extensions/cornerstone/src/components/ManualPanorama/reconstruction';
import {
  clampWorld,
  dot,
  makeCpuPlane,
  planeAxes,
  planePoint,
  plus,
  projectPoint,
  type Basis,
  type CpuGeometry,
  type CpuPlane,
  type PlaneId,
} from './cpuGeometry';
import type { CpuWorkerClient } from './CpuWorkerClient';
import type { CpuWindow } from './cpuRendering';

export type CpuTool = 'crosshair' | 'pan' | 'window' | 'length' | 'arch';
export type CpuMeasurement = { plane: PlaneId; a: Point3; b: Point3 };
type Props = {
  id: PlaneId;
  geometry: CpuGeometry;
  worker: CpuWorkerClient;
  revision: number;
  point: Point3;
  basis: Basis;
  window: CpuWindow;
  setWindow: (value: CpuWindow) => void;
  onPoint: (point: Point3) => void;
  tool: CpuTool;
  axes: boolean;
  active: boolean;
  onActive: () => void;
  onFocus: () => void;
  thickness: number;
  projection: 'mean' | 'mip';
  measurements: CpuMeasurement[];
  onMeasure: (value: CpuMeasurement) => void;
  archPoints: Point3[];
  onArchPoint: (point: Point3) => void;
  onError: (message: string) => void;
  onRotate: (id: PlaneId, angle: number) => void;
};
export default function CpuViewport(props: Props) {
  const { id, geometry, worker, revision, point, basis, window: voi, tool, axes } = props;
  const stage = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 400, height: 300 });
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState<[number, number]>([0, 0]);
  const [image, setImage] = useState<{ pixels: Uint8ClampedArray; plane: CpuPlane }>(null);
  const [busy, setBusy] = useState(false),
    [draft, setDraft] = useState<CpuMeasurement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    pan: [number, number];
    window: CpuWindow;
    start: Point3;
  }>(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);
  const plane = useMemo(() => {
    const width = Math.max(128, Math.min(props.thickness ? 384 : 768, Math.round(size.width)));
    return makeCpuPlane(
      geometry,
      id,
      basis,
      point,
      width,
      Math.max(64, Math.round((width * size.height) / size.width)),
      zoom,
      pan
    );
  }, [geometry, id, basis, point, size, zoom, pan, props.thickness]);
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    const timer = setTimeout(() => {
      worker
        .request('render', {
          plane,
          window: voi,
          options: { thickness: props.thickness, projection: props.projection },
        })
        .then(result => {
          if (!cancelled) {
            setImage(result);
            setBusy(false);
          }
        })
        .catch(error => {
          if (!cancelled && error.name !== 'AbortError') {
            setBusy(false);
            props.onError(error.message);
          }
        });
    }, 20);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [worker, plane, voi, revision, props.thickness, props.projection]);
  useLayoutEffect(() => {
    if (!image || !canvas.current) return;
    const { plane, pixels } = image;
    canvas.current.width = plane.width;
    canvas.current.height = plane.height;
    const context = canvas.current.getContext('2d');
    if (!context) {
      props.onError('Браузер не предоставляет Canvas 2D. Обновите браузер.');
      return;
    }
    const buffer = context.createImageData(plane.width, plane.height);
    buffer.data.set(pixels);
    context.putImageData(buffer, 0, 0);
  }, [image]);
  const displayed = image?.plane;
  useEffect(() => {
    const element = stage.current;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      props.onActive();
      if (tool === 'arch' && props.archPoints.length) return;
      if (!event.deltaY) return;
      const normal = planeAxes(id, basis).normal;
      props.onPoint(
        clampWorld(geometry, plus(point, normal, Math.sign(event.deltaY) * geometry.step))
      );
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [point, geometry, id, basis, props.onPoint, tool, props.archPoints.length]);
  const at = (event: React.PointerEvent): Point3 => {
    const rect = stage.current.getBoundingClientRect();
    return planePoint(
      displayed,
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height
    );
  };
  const project = (value: Point3) => projectPoint(displayed, value);
  const visibleMeasurements = displayed
    ? [...props.measurements, ...(draft ? [draft] : [])].filter(
        value =>
          value.plane === id &&
          [value.a, value.b].every(
            p =>
              Math.abs(dot(plus(p, displayed.origin, -1), displayed.normal)) <
              geometry.step / 2 + 0.01
          )
      )
    : [];
  const crosshair = displayed && project(point);
  const endDrag = (event: React.PointerEvent) => {
    if (!drag.current) return;
    if (tool === 'length' && draft && Math.hypot(...plus(draft.a, draft.b, -1)) > 0.1)
      props.onMeasure(draft);
    setDraft(null);
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const horizontal = id === 'axial' ? ORBITAL_MPR_COLORS.coronal : ORBITAL_MPR_COLORS.axial;
  const vertical = id === 'sagittal' ? ORBITAL_MPR_COLORS.coronal : ORBITAL_MPR_COLORS.sagittal;
  const ruler = displayed ? Math.min(20, displayed.widthMm / 4) : 20;
  const orientation = (vector: number[]) => {
    const axis = vector.reduce(
      (best, value, i) => (Math.abs(value) > Math.abs(vector[best]) ? i : best),
      0
    );
    return [
      ['R', 'L'],
      ['A', 'P'],
      ['F', 'H'],
    ][axis][vector[axis] > 0 ? 1 : 0];
  };
  return (
    <section
      className={`cpu-viewport ${props.active ? 'is-active' : ''}`}
      data-cpu-viewport={id}
      onPointerDown={props.onActive}
    >
      <header>
        <strong style={{ color: ORBITAL_MPR_COLORS[id] }}>
          {id === 'coronal' ? 'Coronal' : id === 'sagittal' ? 'Sagittal' : 'Axial'}
        </strong>
        <span>
          {busy ? 'Расчёт…' : `${zoom.toFixed(1)}×`} · CPU
          {props.thickness > 0 ? ` · слой ${props.thickness} мм` : ''}
        </span>
        <button
          title="Повернуть плоскости на −5°"
          onClick={() => props.onRotate(id, -5)}
        >
          ↶
        </button>
        <button
          title="Повернуть плоскости на 5°"
          onClick={() => props.onRotate(id, 5)}
        >
          ↷
        </button>
        <button
          aria-label={`Увеличить ${id}`}
          onClick={() => setZoom(value => Math.min(12, value * 1.25))}
        >
          +
        </button>
        <button
          aria-label={`Уменьшить ${id}`}
          onClick={() => setZoom(value => Math.max(0.25, value / 1.25))}
        >
          −
        </button>
        <button
          title="Вписать изображение"
          onClick={() => {
            setZoom(1);
            setPan([0, 0]);
          }}
        >
          ⊙
        </button>
        <button
          aria-label={`Развернуть ${id}`}
          onClick={props.onFocus}
        >
          ⛶
        </button>
      </header>
      <div
        className={`cpu-stage cpu-tool-${tool}`}
        ref={stage}
        tabIndex={-1}
        onContextMenu={event => event.preventDefault()}
        onPointerDown={event => {
          if (!displayed || event.button !== 0) return;
          event.preventDefault();
          // Move keyboard focus off toolbar buttons so Enter controls the axes.
          event.currentTarget.focus({ preventScroll: true });
          const start = at(event);
          if (tool === 'arch') {
            if (id === 'axial') props.onArchPoint(start);
            return;
          }
          if (tool === 'length' && busy) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, pan, window: voi, start };
          if (tool === 'crosshair') props.onPoint(clampWorld(geometry, start));
          if (tool === 'length') setDraft({ plane: id, a: start, b: start });
        }}
        onPointerMove={event => {
          const current = drag.current;
          if (!current || !displayed) return;
          const dx = event.clientX - current.x,
            dy = event.clientY - current.y;
          if (tool === 'pan')
            setPan([
              current.pan[0] - (dx * displayed.widthMm) / size.width,
              current.pan[1] - (dy * displayed.heightMm) / size.height,
            ]);
          else if (tool === 'window')
            props.setWindow({
              center: current.window.center + (dy * current.window.width) / 200,
              width: Math.max(1, current.window.width * Math.exp(dx / 200)),
            });
          else if (tool === 'crosshair') props.onPoint(clampWorld(geometry, at(event)));
          else if (tool === 'length') setDraft({ plane: id, a: current.start, b: at(event) });
        }}
        onPointerUp={endDrag}
        onPointerCancel={() => {
          drag.current = null;
          setDraft(null);
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        <canvas
          ref={canvas}
          aria-label={`${id}: изображение CPU`}
        />
        {displayed && (
          <svg
            viewBox={`0 0 ${displayed.width} ${displayed.height}`}
            preserveAspectRatio="none"
            className="cpu-overlay"
            aria-hidden="true"
          >
            {axes && crosshair && (
              <>
                <line
                  x1="0"
                  x2={displayed.width}
                  y1={crosshair[1]}
                  y2={crosshair[1]}
                  stroke={horizontal}
                />
                <line
                  y1="0"
                  y2={displayed.height}
                  x1={crosshair[0]}
                  x2={crosshair[0]}
                  stroke={vertical}
                />
              </>
            )}
            {visibleMeasurements.map((value, i) => {
              const a = project(value.a),
                b = project(value.b);
              return (
                <g
                  key={i}
                  stroke="#e9d5ff"
                >
                  <line
                    x1={a[0]}
                    y1={a[1]}
                    x2={b[0]}
                    y2={b[1]}
                  />
                  <text
                    x={b[0] + 4}
                    y={b[1] - 5}
                    fill="#e9d5ff"
                    stroke="none"
                  >
                    {Math.hypot(...plus(value.a, value.b, -1)).toFixed(1)} мм
                  </text>
                </g>
              );
            })}
            {id === 'axial' && props.archPoints.length > 0 && (
              <g
                stroke="#c084fc"
                fill="#c084fc"
              >
                <polyline
                  points={props.archPoints.map(p => project(p).join(',')).join(' ')}
                  fill="none"
                />
                {props.archPoints.map((p, i) => {
                  const [x, y] = project(p);
                  return (
                    <circle
                      key={i}
                      cx={x}
                      cy={y}
                      r="3"
                    />
                  );
                })}
              </g>
            )}
            <g
              stroke="#b4beca"
              fill="#b4beca"
            >
              <line
                x1="12"
                x2={12 + (ruler / displayed.widthMm) * displayed.width}
                y1={displayed.height - 12}
                y2={displayed.height - 12}
              />
              <text
                x="12"
                y={displayed.height - 18}
                stroke="none"
              >
                {ruler.toFixed(ruler < 20 ? 1 : 0)} мм
              </text>
              <text
                x={displayed.width / 2}
                y="15"
                textAnchor="middle"
                stroke="none"
              >
                {orientation(displayed.v.map(v => -v))}
              </text>
              <text
                x="7"
                y={displayed.height / 2}
                stroke="none"
              >
                {orientation(displayed.h.map(v => -v))}
              </text>
              <text
                x={displayed.width - 7}
                y={displayed.height / 2}
                textAnchor="end"
                stroke="none"
              >
                {orientation(displayed.h)}
              </text>
            </g>
          </svg>
        )}
        {!image && <p className="cpu-placeholder">Подготовка среза…</p>}
      </div>
    </section>
  );
}
