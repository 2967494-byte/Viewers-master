import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cache, Enums, eventTarget, getEnabledElement, utilities } from '@cornerstonejs/core';
import {
  buildCurve,
  createTrilinearSampler,
  curveFrame,
  distance,
  normalize,
  reconstructPanorama,
  reconstructSections,
  type Point3,
  type Raster,
} from './reconstruction';
import RasterView from './RasterView';
import { getPanoramaSession, matchesPanorama } from './panoramaSession';
import { detectDentalArch, volumeWorldBounds } from './automaticArch';
import { movePointInArchPlane } from './archEditing';
import './ManualPanorama.css';
import { getFocusedMprViewport, setMprFocus } from '../../utils/mprFocusLayout';

export const START_MANUAL_PANORAMA = 'orbital:start-manual-panorama';
export const START_AUTOMATIC_PANORAMA = 'orbital:start-automatic-panorama';

function ArchOverlay({
  source,
  points,
  setPoints,
  curve,
  drawing,
  finish,
  geometry,
  up,
  center,
  step,
  onCenter,
  onEditingChange = (_editing: boolean) => {},
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<{
    pointerId: number;
    move: (event: PointerEvent) => void;
    finish: () => void;
  } | null>(null);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!dragging.current || event.pointerId !== dragging.current.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      dragging.current.move(event);
    };
    const end = (event?: PointerEvent) => {
      const drag = dragging.current;
      if (!drag || (event && event.pointerId !== drag.pointerId)) return;
      dragging.current = null;
      if (svgRef.current?.hasPointerCapture?.(drag.pointerId))
        svgRef.current.releasePointerCapture(drag.pointerId);
      drag.finish();
    };
    const blur = () => end();
    window.addEventListener('pointermove', move, { capture: true, passive: false });
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
      window.removeEventListener('blur', blur);
      dragging.current = null;
    };
  }, []);
  const displayCurve = useMemo(() => {
    if (curve) return curve;
    if (!drawing || points.length < 2) return null;
    try {
      return buildCurve(points, { preview: true });
    } catch {
      return null;
    }
  }, [curve, drawing, points]);
  const project = (point: Point3) => {
    const p = source.worldToCanvas(point);
    return [geometry.left + p[0] * geometry.scale, geometry.top + p[1] * geometry.scale];
  };
  const toWorld = (event): Point3 => {
    const rect = svgRef.current.getBoundingClientRect();
    return source.canvasToWorld([
      (event.clientX - rect.left - geometry.left) / geometry.scale,
      (event.clientY - rect.top - geometry.top) / geometry.scale,
    ]);
  };
  const path = (displayCurve?.points || points).map(project);
  const tickDistances = displayCurve
    ? Array.from({ length: Math.floor(displayCurve.length / 2) + 1 }, (_, i) => i * 2)
    : [];
  const sectionCenter = drawing ? (displayCurve?.length || 0) / 2 : center;
  const archCenter = path.length
    ? path.reduce((sum, p) => [sum[0] + p[0] / path.length, sum[1] + p[1] / path.length], [0, 0])
    : [0, 0];
  return (
    <svg
      ref={svgRef}
      className="manual-arch-overlay"
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      aria-label="Зубная дуга: точки можно перетаскивать"
      onClick={event => {
        if (event.button !== 0 || event.detail > 1 || !drawing) return;
        const point = toWorld(event);
        setPoints(previous =>
          !previous.length || distance(previous[previous.length - 1], point) > 0.5
            ? [...previous, point]
            : previous
        );
      }}
      onDoubleClick={event => {
        event.preventDefault();
        if (drawing) finish();
      }}
      onDragStart={event => event.preventDefault()}
      onWheel={event => {
        event.stopPropagation();
        if (dragging.current) return;
        utilities.scroll(source, {
          delta: Math.sign(event.deltaY),
          volumeId: source.getVolumeId(),
        });
      }}
    >
      {tickDistances.map(mm => {
        const { point, normal } = curveFrame(displayCurve, mm, up);
        const a = project(point.map((v, i) => v - normal[i] * 20) as Point3);
        const b = project(point.map((v, i) => v + normal[i] * 20) as Point3);
        const label =
          Math.hypot(a[0] - archCenter[0], a[1] - archCenter[1]) >
          Math.hypot(b[0] - archCenter[0], b[1] - archCenter[1])
            ? a
            : b;
        return (
          <g
            key={mm}
            className="manual-section-tick"
            pointerEvents={drawing ? 'none' : undefined}
            onClick={event => {
              if (drawing) return;
              event.stopPropagation();
              onCenter(mm);
            }}
          >
            <line
              x1={a[0]}
              y1={a[1]}
              x2={b[0]}
              y2={b[1]}
              stroke="#84cc16"
              strokeOpacity="0.55"
            />
            {mm % 10 === 0 && (
              <text
                x={label[0] + 3}
                y={label[1]}
                fill="#c3ed5b"
                fontSize="11"
              >
                {mm}
              </text>
            )}
          </g>
        );
      })}
      {displayCurve &&
        Array.from({ length: 9 }, (_, i) => sectionCenter + (i - 4) * step)
          .filter(mm => mm >= 0 && mm <= displayCurve.length)
          .map((mm, i) => {
            const { point, normal } = curveFrame(displayCurve, mm, up);
            const a = project(point.map((v, axis) => v - normal[axis] * 22) as Point3);
            const b = project(point.map((v, axis) => v + normal[axis] * 22) as Point3);
            return (
              <line
                key={i}
                x1={a[0]}
                y1={a[1]}
                x2={b[0]}
                y2={b[1]}
                stroke={Math.abs(mm - sectionCenter) < 0.01 ? '#fb923c' : '#facc15'}
                strokeWidth={Math.abs(mm - sectionCenter) < 0.01 ? 2 : 1}
                pointerEvents="none"
              />
            );
          })}
      {path.length > 1 && (
        <polyline
          points={path.map(p => p.join(',')).join(' ')}
          fill="none"
          stroke="#38d9ff"
          strokeWidth="2.5"
          pointerEvents="none"
        />
      )}
      {points.map((point, index) => {
        const p = project(point);
        return (
          <circle
            key={index}
            cx={p[0]}
            cy={p[1]}
            r="7"
            fill="#082f49"
            stroke="#67e8f9"
            strokeWidth="2.5"
            style={{ cursor: 'grab' }}
            onClick={event => event.stopPropagation()}
            onPointerDown={event => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              const start = toWorld(event);
              const original = [...point] as Point3;
              dragging.current = {
                pointerId: event.pointerId,
                move: moveEvent => {
                  const next = movePointInArchPlane(original, start, toWorld(moveEvent), up);
                  setPoints(previous => previous.map((p, i) => (i === index ? next : p)));
                },
                finish: () => onEditingChange(false),
              };
              onEditingChange(true);
              svgRef.current.setPointerCapture?.(event.pointerId);
            }}
          >
            <title>Точка {index + 1}: перетащите для изменения дуги</title>
          </circle>
        );
      })}
    </svg>
  );
}

function AxialPreview({
  source,
  points,
  setPoints,
  curve,
  up,
  center,
  step,
  onCenter,
  onEditingChange,
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [geometry, setGeometry] = useState(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let frame = 0;
    const draw = () => {
      frame = 0;
      const rect = canvas.getBoundingClientRect();
      const width = rect.width,
        height = rect.height;
      if (!width || !height) return;
      const scale = Math.min(
        width / source.element.clientWidth,
        height / source.element.clientHeight
      );
      const left = (width - source.element.clientWidth * scale) / 2;
      const top = (height - source.element.clientHeight * scale) / 2;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.drawImage(
        source.canvas,
        left,
        top,
        source.element.clientWidth * scale,
        source.element.clientHeight * scale
      );
      setGeometry({ width, height, scale, left, top });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(canvas);
    source.element.addEventListener(Enums.Events.IMAGE_RENDERED, schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      source.element.removeEventListener(Enums.Events.IMAGE_RENDERED, schedule);
    };
  }, [source]);
  return (
    <div className="manual-axial-preview">
      <canvas
        ref={ref}
        aria-label="Аксиальный срез с зубной дугой"
      />
      {geometry && (
        <ArchOverlay
          {...{
            source,
            points,
            setPoints,
            curve,
            up,
            center,
            step,
            onCenter,
            geometry,
            onEditingChange,
          }}
          drawing={false}
          finish={() => {}}
        />
      )}
    </div>
  );
}

/** Manual CPR workspace. The bottom-right cell stays transparent for the live Cornerstone 3D viewport. */
export default function ManualPanorama({
  element: elementProp,
  getElement = undefined,
  externalLauncher = false,
  viewportGridService,
}) {
  const element = elementProp || getElement?.();
  const [stage, setStage] = useState<'idle' | 'drawing' | 'detecting' | 'autoError' | 'review'>(
    'idle'
  );
  const [automatic, setAutomatic] = useState(false);
  const [autoProgress, setAutoProgress] = useState(0);
  const autoController = useRef<AbortController>(null);
  const launchGeneration = useRef(0);
  const [points, setPoints] = useState<Point3[]>([]);
  const [context, setContext] = useState(null);
  const [layout, setLayout] = useState(null);
  const [panorama, setPanorama] = useState<Raster>(null);
  const [sections, setSections] = useState([]);
  const [center, setCenter] = useState(0);
  const [step, setStep] = useState(2);
  const [thickness, setThickness] = useState(20);
  const [heightMm, setHeightMm] = useState(80);
  const [projection, setProjection] = useState<'mean' | 'mip'>('mean');
  const [range, setRange] = useState({ lower: -500, upper: 2500 });
  const [sharpness, setSharpness] = useState(5);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sectionBusy, setSectionBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [sliceOffset, setSliceOffset] = useState(0);
  const [error, setError] = useState('');
  const [coverageWarning, setCoverageWarning] = useState('');
  const editPoints = useCallback(update => {
    setCoverageWarning('');
    setPoints(update);
  }, []);
  const activeVolume = useRef<string>(null);
  const activeSession = useRef<ReturnType<typeof getPanoramaSession>>(null);
  const generation = useRef(0);
  const sectionGeneration = useRef(0);
  const [source, setSource] = useState<any>(() =>
    element ? getEnabledElement(element)?.viewport : null
  );
  const [headerHost, setHeaderHost] = useState<HTMLElement>(null);
  useLayoutEffect(() => {
    setHeaderHost(document.getElementById('orbital-panorama-header-slot'));
  }, []);
  const curve = useMemo(() => {
    try {
      return buildCurve(points);
    } catch {
      return null;
    }
  }, [points]);
  const close = useCallback(() => {
    launchGeneration.current++;
    autoController.current?.abort();
    generation.current++;
    sectionGeneration.current++;
    setStage('idle');
    setContext(null);
    setPanorama(null);
    setSections([]);
    setError('');
    setCoverageWarning('');
    setEditing(false);
    activeVolume.current = null;
    activeSession.current = null;
  }, []);
  useEffect(
    () => () => {
      launchGeneration.current++;
      autoController.current?.abort();
    },
    []
  );

  useEffect(() => {
    if (!element) return;
    const update = () => setSource(getEnabledElement(element)?.viewport || null);
    const onEnabled = event => {
      if (event.detail?.element === element) update();
    };
    const onDisabled = event => {
      if (event.detail?.element !== element) return;
      setSource(null);
      close();
    };
    eventTarget.addEventListener(Enums.Events.ELEMENT_ENABLED, onEnabled);
    eventTarget.addEventListener(Enums.Events.ELEMENT_DISABLED, onDisabled);
    element.addEventListener(Enums.Events.IMAGE_RENDERED, update);
    element.addEventListener(Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME, update);
    update();
    return () => {
      eventTarget.removeEventListener(Enums.Events.ELEMENT_ENABLED, onEnabled);
      eventTarget.removeEventListener(Enums.Events.ELEMENT_DISABLED, onDisabled);
      element.removeEventListener(Enums.Events.IMAGE_RENDERED, update);
      element.removeEventListener(Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME, update);
    };
  }, [element, close]);

  const start = useCallback(
    async (findAutomatically = false, forceSearch = false) => {
      const owner = ++launchGeneration.current;
      autoController.current?.abort();
      const controller = new AbortController();
      autoController.current = controller;
      const isCurrent = () => !controller.signal.aborted && owner === launchGeneration.current;
      try {
        const focusedId = getFocusedMprViewport(viewportGridService.getState());
        // Keep the large axial canvas available while placing the arch points.
        if (focusedId && (findAutomatically || focusedId !== 'mpr-axial'))
          await setMprFocus(viewportGridService, null);
        if (!isCurrent()) return;
        const enabled = getEnabledElement(element);
        const viewport = enabled?.viewport as any;
        const volume = cache.getVolume(viewport?.getVolumeId?.());
        if (!volume || !volume.loadStatus.loaded)
          throw new Error('Дождитесь полной загрузки исследования.');
        if (
          volume.isDynamicVolume() ||
          volume.voxelManager.numberOfComponents > 1 ||
          volume.metadata?.SamplesPerPixel > 1
        )
          throw new Error('Выберите обычную серию КТ / КЛКТ.');
        const data = viewport.getImageData();
        const slices = volume.imageIds.map(id => cache.getImage(id)?.voxelManager);
        if (slices.length !== data.dimensions[2] || slices.some(slice => !slice))
          throw new Error('Не все срезы доступны. Дождитесь полной загрузки.');
        const up: Point3 = findAutomatically
          ? [0, 0, 1]
          : normalize(viewport.getCamera().viewPlaneNormal as Point3);
        if (up[2] < 0)
          up.forEach((v, i) => {
            up[i] = -v;
          });
        const sample = createTrilinearSampler(
          data.dimensions,
          data.imageData.getWorldToIndex(),
          (i, j, k) => slices[k].getAtIndex(j * data.dimensions[0] + i) as number
        );
        activeVolume.current = volume.volumeId;
        const session = getPanoramaSession(volume);
        activeSession.current = session;
        if (forceSearch) session.invalidate();
        generation.current++;
        sectionGeneration.current++;
        setContext({ sample, up });
        const voi = viewport.getProperties().voiRange;
        if (voi && voi.upper > voi.lower) setRange({ lower: voi.lower, upper: voi.upper });
        setThickness(20);
        setSharpness(5);
        setAutomatic(findAutomatically);
        setAutoProgress(0);
        setPoints([]);
        setPanorama(null);
        setSections([]);
        setBusy(false);
        setSectionBusy(false);
        setError('');
        setCoverageWarning('');
        setEditing(false);
        setStage(findAutomatically ? 'detecting' : 'drawing');
        if (findAutomatically) {
          if (!forceSearch && session.pending) {
            const update = () => {
              if (isCurrent()) setAutoProgress(session.state.progress);
            };
            const unsubscribe = session.subscribe(update);
            update();
            try {
              await session.pending;
            } finally {
              unsubscribe();
            }
            if (!isCurrent()) return;
          }
          const saved = !forceSearch ? session.state.snapshot : null;
          if (!saved) session.reserveEditor(controller);
          const result = saved
            ? {
                points: saved.points,
                sliceZ: saved.points[Math.floor(saved.points.length / 2)][2],
                coverageWarning: saved.coverageWarning,
              }
            : await detectDentalArch({
                sample,
                bounds: volumeWorldBounds(data.dimensions, p => data.imageData.indexToWorld(p)),
                signal: controller.signal,
                onProgress: percent => {
                  if (isCurrent()) {
                    setAutoProgress(percent);
                    session.reportEditor(controller, percent);
                  }
                },
              });
          if (!isCurrent()) return;
          if (viewport.getVolumeId() !== volume.volumeId) {
            close();
            return;
          }
          const controlPoints = result.points;
          const autoCurve = buildCurve(controlPoints);
          viewport.setOrientation(Enums.OrientationAxis.AXIAL);
          const camera = viewport.getCamera();
          const middle = result.points[Math.floor(result.points.length / 2)];
          const target = [middle[0], (middle[1] + result.points[0][1]) / 2, result.sliceZ];
          const delta = target.map((v, i) => v - camera.focalPoint[i]);
          viewport.setCamera({
            focalPoint: target,
            position: camera.position.map((v, i) => v + delta[i]),
          });
          viewport.render();
          setPoints(controlPoints);
          setCoverageWarning(result.coverageWarning || '');
          if (saved) {
            setContext({ sample, up: saved.up });
            setThickness(saved.thickness);
            setHeightMm(saved.heightMm);
            setProjection(saved.projection);
            setRange(saved.range);
            setSharpness(saved.sharpness);
            setStep(saved.step);
            setPanorama(saved.raster);
          }
          setCenter(saved?.center ?? autoCurve.length / 2);
          setStage('review');
        }
      } catch (e) {
        if (!isCurrent()) return;
        setError(e.message);
        if (findAutomatically && activeVolume.current) setStage('autoError');
      }
    },
    [element, viewportGridService, close]
  );

  useEffect(() => {
    document.body.classList.toggle('manual-panorama-active', stage !== 'idle');
    return () => document.body.classList.remove('manual-panorama-active');
  }, [stage]);

  const finish = async () => {
    if (!curve) {
      setError('Отметьте минимум три точки вдоль зубной дуги.');
      return;
    }
    const owner = generation.current;
    const volumeId = activeVolume.current;
    if (getFocusedMprViewport(viewportGridService.getState())) {
      await setMprFocus(viewportGridService, null);
      // Let the native viewports resize before positioning the CPR workspace.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    // Escape, another study or a new drawing must not be reopened by an old finish.
    if (generation.current !== owner || activeVolume.current !== volumeId) return;
    setCenter(curve.length / 2);
    setError('');
    setStage('review');
  };

  useEffect(() => {
    const manual = () => {
      void start(false);
    };
    const automatic = () => {
      void start(true);
    };
    window.addEventListener(START_MANUAL_PANORAMA, manual);
    window.addEventListener(START_AUTOMATIC_PANORAMA, automatic);
    return () => {
      window.removeEventListener(START_MANUAL_PANORAMA, manual);
      window.removeEventListener(START_AUTOMATIC_PANORAMA, automatic);
    };
  }, [start]);
  useEffect(() => {
    if (!source || stage === 'idle') return;
    const resize = () => {
      const engine = getEnabledElement(element)?.renderingEngine;
      const first = engine?.getViewport('mpr-coronal')?.element.getBoundingClientRect();
      const last = engine?.getViewport('mpr-3d')?.element.getBoundingClientRect();
      if (first && last)
        setLayout({
          left: first.left,
          top: first.top,
          width: last.right - first.left,
          height: last.bottom - first.top,
          column: last.left - first.left,
          row: last.top - first.top,
        });
    };
    const onVolume = () => {
      if (source.getVolumeId() !== activeVolume.current) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', escape);
    element.addEventListener(Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME, onVolume);
    resize();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', escape);
      element.removeEventListener(Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME, onVolume);
    };
  }, [source, stage, element, close]);

  useEffect(() => {
    if (!source || stage !== 'review' || !curve || !context) return;
    const update = () => {
      const focal = source.getCamera().focalPoint;
      setSliceOffset(
        context.up.reduce((sum, v, i) => sum + v * (focal[i] - curve.points[0][i]), 0)
      );
    };
    element.addEventListener(Enums.Events.CAMERA_MODIFIED, update);
    update();
    return () => element.removeEventListener(Enums.Events.CAMERA_MODIFIED, update);
  }, [source, element, stage, curve, context]);

  useEffect(() => {
    if (editing) {
      setBusy(false);
      return;
    }
    if (stage !== 'review' || !curve || !context) return;
    const session = activeSession.current;
    if (
      matchesPanorama(session?.state.snapshot, points, context.up, {
        thickness,
        heightMm,
        projection,
      })
    ) {
      setPanorama(session.state.snapshot.raster);
      setBusy(false);
      return;
    }
    const controller = new AbortController(),
      attempt = ++generation.current;
    setBusy(true);
    setError('');
    setProgress(0);
    setPanorama(null);
    const timer = setTimeout(() => {
      reconstructPanorama({
        curve,
        ...context,
        thickness,
        heightMm,
        mode: projection,
        signal: controller.signal,
        onProgress: percent => {
          if (!controller.signal.aborted && generation.current === attempt) setProgress(percent);
        },
      })
        .then(result => {
          if (!controller.signal.aborted && generation.current === attempt) {
            setPanorama(result);
            setBusy(false);
            session?.publish({
              points,
              curve,
              up: context.up,
              raster: result,
              thickness,
              heightMm,
              projection,
              range,
              sharpness,
              center,
              step,
              coverageWarning,
            });
          }
        })
        .catch(e => {
          if (!controller.signal.aborted && generation.current === attempt) {
            setError(e.message);
            setBusy(false);
          }
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [stage, curve, context, thickness, heightMm, projection, editing]);
  useEffect(() => {
    const session = activeSession.current;
    const saved = session?.state.snapshot;
    if (
      stage === 'review' &&
      panorama &&
      panorama === saved?.raster &&
      matchesPanorama(saved, points, context.up, { thickness, heightMm, projection }) &&
      (saved.range !== range ||
        saved.sharpness !== sharpness ||
        saved.center !== center ||
        saved.step !== step ||
        saved.coverageWarning !== coverageWarning)
    ) {
      session.publish({ ...saved, range, sharpness, center, step, coverageWarning });
    }
  }, [
    stage,
    panorama,
    points,
    context,
    thickness,
    heightMm,
    projection,
    range,
    sharpness,
    center,
    step,
    coverageWarning,
  ]);
  useEffect(() => {
    if (editing) {
      setSectionBusy(false);
      return;
    }
    if (stage !== 'review' || !curve || !context) return;
    const session = activeSession.current;
    const saved = session?.sections;
    if (
      saved?.points === points &&
      saved.up.every((v, i) => v === context.up[i]) &&
      saved.heightMm === heightMm &&
      saved.center === center &&
      saved.step === step
    ) {
      setSections(saved.result);
      setSectionBusy(false);
      return;
    }
    const controller = new AbortController(),
      attempt = ++sectionGeneration.current;
    setSectionBusy(true);
    setSections([]);
    const timer = setTimeout(() => {
      reconstructSections({ curve, ...context, center, step, heightMm, signal: controller.signal })
        .then(result => {
          if (!controller.signal.aborted && sectionGeneration.current === attempt) {
            setSections(result);
            setSectionBusy(false);
            if (session)
              session.sections = { points, up: context.up, heightMm, center, step, result };
          }
        })
        .catch(e => {
          if (!controller.signal.aborted && sectionGeneration.current === attempt) {
            setError(e.message);
            setSectionBusy(false);
          }
        });
    }, 100);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [stage, curve, context, center, step, heightMm, editing]);

  if (!element) return null;
  const selectCenter = mm => setCenter(Math.max(0, Math.min(curve?.length || 0, mm)));
  const drawingGeometry = {
    width: element.clientWidth,
    height: element.clientHeight,
    scale: 1,
    left: 0,
    top: 0,
  };
  const controlPanel = (
    <div
      className={['manual-panorama-toolbar', stage === 'idle' && 'manual-panorama-toolbar--idle']
        .filter(Boolean)
        .join(' ')}
      role="toolbar"
      aria-label={automatic ? 'Автоматическая панорама' : 'Ручная панорама'}
    >
      {stage === 'idle' ? (
        externalLauncher ? null : (
          <button
            className="manual-panorama-launcher"
            onClick={() => start(false)}
            aria-label="Панорама"
            title="Построить панораму по точкам зубной дуги"
          >
            <svg
              width="32"
              height="32"
              viewBox="0 0 32 32"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 24C5 7 27 7 27 24 M2 22h6 M5 12l4 3 M16 6v7 M27 12l-4 3 M24 22h6" />
              <circle
                cx="5"
                cy="24"
                r="1.6"
                fill="currentColor"
                stroke="none"
              />
              <circle
                cx="16"
                cy="11.25"
                r="1.6"
                fill="currentColor"
                stroke="none"
              />
              <circle
                cx="27"
                cy="24"
                r="1.6"
                fill="currentColor"
                stroke="none"
              />
            </svg>
          </button>
        )
      ) : (
        <>
          {stage === 'detecting' || stage === 'autoError' ? (
            <>
              <span>
                {stage === 'detecting'
                  ? `Ищем зубную дугу… ${autoProgress}%`
                  : 'Автопоиск не завершён'}
              </span>
              {stage === 'autoError' && (
                <button onClick={() => start(true, true)}>Повторить автопоиск</button>
              )}
              <button onClick={() => start(false)}>Построить вручную</button>
            </>
          ) : stage === 'drawing' ? (
            <>
              <span>Точки вдоль дуги · двойной щелчок — готово</span>
              <button
                disabled={!points.length}
                onClick={() => setPoints(p => p.slice(0, -1))}
              >
                Убрать точку
              </button>
              <button
                disabled={!curve}
                onClick={finish}
              >
                Построить
              </button>
            </>
          ) : (
            <>
              <label>
                Слой{' '}
                <select
                  aria-label="Толщина панорамы"
                  value={thickness}
                  onChange={e => setThickness(Number(e.target.value))}
                >
                  {[1, 2, 5, 10, 20, 25, 30].map(v => (
                    <option
                      key={v}
                      value={v}
                    >
                      {v} мм
                    </option>
                  ))}
                </select>
              </label>
              <select
                aria-label="Проекция панорамы"
                value={projection}
                onChange={e => setProjection(e.target.value as 'mean' | 'mip')}
              >
                <option value="mean">Среднее</option>
                <option value="mip">Максимум</option>
              </select>
              <label>
                Высота{' '}
                <select
                  aria-label="Высота панорамы"
                  value={heightMm}
                  onChange={e => setHeightMm(Number(e.target.value))}
                >
                  {[60, 80, 100, 120, 140].map(v => (
                    <option
                      key={v}
                      value={v}
                    >
                      {v} мм
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Шаг{' '}
                <select
                  aria-label="Шаг поперечных сечений"
                  value={step}
                  onChange={e => setStep(Number(e.target.value))}
                >
                  {[1, 2, 3, 5].map(v => (
                    <option
                      key={v}
                      value={v}
                    >
                      {v} мм
                    </option>
                  ))}
                </select>
              </label>
              <button onClick={() => setStage('drawing')}>Изменить дугу</button>
              {automatic && <button onClick={() => start(true, true)}>Найти дугу заново</button>}
            </>
          )}
          <button onClick={close}>Вернуться в MPR</button>
        </>
      )}
      {error && (
        <span
          className="manual-error"
          role="alert"
        >
          {error}
        </span>
      )}
    </div>
  );
  return (
    <>
      {(stage !== 'idle' || !externalLauncher || error) &&
        createPortal(
          controlPanel,
          stage === 'idle' && !externalLauncher && headerHost ? headerHost : document.body
        )}
      {stage === 'drawing' && source && (
        <div className="manual-drawing">
          <ArchOverlay
            {...{ source, points, curve }}
            setPoints={editPoints}
            drawing
            finish={finish}
            geometry={drawingGeometry}
            up={context.up}
            center={center}
            step={step}
            onCenter={selectCenter}
            onEditingChange={setEditing}
          />
          <div className="manual-drawing-hint">
            Выберите колёсиком срез с зубным рядом. Отметьте дугу от одного края до другого.
          </div>
        </div>
      )}
      {(stage === 'review' || stage === 'detecting' || stage === 'autoError') &&
        source &&
        layout &&
        createPortal(
          <div
            className="manual-panorama-workspace"
            style={{
              left: layout.left,
              top: layout.top,
              width: layout.width,
              height: layout.height,
              gridTemplateColumns: `${layout.column}px 1fr`,
              gridTemplateRows: `${layout.row}px 1fr`,
            }}
          >
            <section className="manual-panel">
              <header>
                Поперечные сечения{' '}
                <span>
                  {stage !== 'review'
                    ? 'Ожидание зубной дуги'
                    : sectionBusy
                      ? 'Построение…'
                      : `Шаг ${step} мм · выберите позицию на панораме`}
                </span>
              </header>
              <div
                className="manual-sections"
                onWheel={e => {
                  if (curve) selectCenter(center + Math.sign(e.deltaY) * step);
                }}
              >
                {Array.from({ length: 9 }, (_, index) => {
                  const section = sections[index];
                  return (
                    <div
                      key={index}
                      className={`manual-section ${index === 4 ? 'selected' : ''}`}
                      onClick={() => section?.raster && selectCenter(section.distance)}
                    >
                      {section?.raster && (
                        <>
                          <span className="manual-section-label">
                            {section.distance.toFixed(1)} мм
                          </span>
                          <RasterView
                            raster={section.raster}
                            range={range}
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
            <section className="manual-panel">
              <header>
                Аксиальный срез{' '}
                <span>
                  {stage === 'review'
                    ? automatic
                      ? 'Автодуга · проверьте и поправьте точки'
                      : 'Перетаскивайте точки дуги · колесо — выбор среза'
                    : 'Автоматическое определение дуги'}
                </span>
              </header>
              {coverageWarning && (
                <div
                  className="manual-coverage-warning"
                  role="alert"
                >
                  {coverageWarning}
                </div>
              )}
              <AxialPreview
                {...{ source, points, curve, center, step }}
                setPoints={editPoints}
                up={context.up}
                onCenter={selectCenter}
                onEditingChange={setEditing}
              />
            </section>
            <section className="manual-panel">
              <header>
                Панорама{' '}
                <span>
                  {curve
                    ? `${curve.length.toFixed(1)} мм · слой ${thickness} мм${busy ? ` · ${progress}%` : ''}`
                    : 'Автоматическое построение'}
                </span>
              </header>
              <div className="manual-panorama-image">
                {panorama && curve && (
                  <RasterView
                    raster={panorama}
                    range={range}
                    sharpness={sharpness}
                    position={center / curve.length}
                    slicePosition={
                      ((panorama.topMm ?? panorama.heightMm / 2) - sliceOffset) / panorama.heightMm
                    }
                    orientation={
                      Math.abs(curve.points[0][0] - curve.points[curve.points.length - 1][0]) > 1
                        ? curve.points[0][0] < curve.points[curve.points.length - 1][0]
                          ? ['R', 'L']
                          : ['L', 'R']
                        : ['Начало', 'Конец']
                    }
                    onPosition={(fraction, vertical) => {
                      selectCenter(fraction * curve.length);
                      const offset =
                        (panorama.topMm ?? panorama.heightMm / 2) -
                        vertical * panorama.heightMm -
                        sliceOffset;
                      const camera = source.getCamera();
                      source.setCamera({
                        focalPoint: camera.focalPoint.map((v, i) => v + context.up[i] * offset),
                        position: camera.position.map((v, i) => v + context.up[i] * offset),
                      });
                      source.render();
                    }}
                  />
                )}
                {(busy || stage === 'detecting') && (
                  <div
                    className="manual-progress"
                    role="status"
                  >
                    {stage === 'detecting'
                      ? `Ищем зубную дугу… ${autoProgress}%`
                      : `Строим панораму… ${progress}%`}
                  </div>
                )}
                {stage === 'autoError' && (
                  <div className="manual-progress manual-auto-failure">
                    Дуга не найдена. Нажмите «Построить вручную».
                  </div>
                )}
              </div>
              <div className="manual-image-controls">
                <label title="Усиление резкости изображения. 1× — исходное отображение">
                  Резкость{' '}
                  <input
                    aria-label="Резкость панорамы"
                    disabled={stage !== 'review'}
                    aria-valuetext={`${sharpness}×`}
                    type="range"
                    min="1"
                    max="10"
                    step="0.25"
                    value={sharpness}
                    onChange={e => setSharpness(Number(e.target.value))}
                  />
                  <output
                    className="manual-sharpness-value"
                    aria-label="Усиление резкости"
                  >
                    {sharpness}×
                  </output>
                </label>
                <label>
                  Контраст{' '}
                  <input
                    aria-label="Контраст панорамы"
                    disabled={stage !== 'review'}
                    type="range"
                    min="200"
                    max="12000"
                    step="50"
                    value={range.upper - range.lower}
                    onChange={e => {
                      const width = Number(e.target.value),
                        mid = (range.lower + range.upper) / 2;
                      setRange({ lower: mid - width / 2, upper: mid + width / 2 });
                    }}
                  />
                </label>
                <label>
                  Яркость{' '}
                  <input
                    aria-label="Яркость панорамы"
                    disabled={stage !== 'review'}
                    type="range"
                    min="-2000"
                    max="6000"
                    step="25"
                    value={(range.lower + range.upper) / 2}
                    onChange={e => {
                      const mid = Number(e.target.value),
                        width = range.upper - range.lower;
                      setRange({ lower: mid - width / 2, upper: mid + width / 2 });
                    }}
                  />
                </label>
              </div>
            </section>
            <div className="manual-live-3d-label">3D · живая модель</div>
          </div>,
          document.body
        )}
    </>
  );
}
