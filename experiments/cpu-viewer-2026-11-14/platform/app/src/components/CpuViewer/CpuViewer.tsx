import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { vec3 } from 'gl-matrix';
import StudyLoadingScreen from '../StudyLoadingScreen/StudyLoadingScreen';
import RasterView from '../../../../../extensions/cornerstone/src/components/ManualPanorama/RasterView';
import { panoramaNavigationTarget } from '../../../../../extensions/cornerstone/src/components/ManualPanorama/panoramaNavigation';
import type {
  Point3,
  Curve,
  Raster,
} from '../../../../../extensions/cornerstone/src/components/ManualPanorama/reconstruction';
import useAxesVisibility from '@ohif/core/src/hooks/useAxesVisibility';
import { setAxesVisible } from '@ohif/core/src/constants/orbitalAxes';
import { CpuWorkerClient } from './CpuWorkerClient';
import CpuViewport, { type CpuTool, type CpuMeasurement } from './CpuViewport';
import {
  IDENTITY_BASIS,
  clampWorld,
  planeAxes,
  transform,
  type Basis,
  type CpuSeries,
  type PlaneId,
} from './cpuGeometry';
import { cpuSources, loadCpuStudy, type CpuProgress } from './cpuStudyLoader';
import './CpuViewer.css';

type Panorama = { raster: Raster; curve: Curve; up: Point3; warning: string };
export default function CpuViewer({ config }: { config: any }) {
  const token = window.location.pathname.match(/\/v\/([^/]+)\/?$/)?.[1] || null;
  const [files, setFiles] = useState<File[] | null>(null),
    [series, setSeries] = useState<CpuSeries | null>(null);
  const [worker, setWorker] = useState<CpuWorkerClient | null>(null),
    [revision, setRevision] = useState(0);
  const [progress, setProgress] = useState<CpuProgress>({
    text: 'Подготовка CPU-режима…',
    percent: 0,
  });
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [loaded, setLoaded] = useState(false);
  const [point, setPoint] = useState<Point3>([0, 0, 0]),
    [basis, setBasis] = useState<Basis>(IDENTITY_BASIS);
  const [windowing, setWindowing] = useState({ center: 1000, width: 3000 });
  const [active, setActive] = useState<PlaneId>('axial'),
    [focus, setFocus] = useState<PlaneId | 'panorama' | null>(null);
  const [tool, setTool] = useState<CpuTool>('crosshair'),
    [measurements, setMeasurements] = useState<CpuMeasurement[]>([]);
  const [thickness, setThickness] = useState(0),
    [projection, setProjection] = useState<'mean' | 'mip'>('mean');
  const [archPoints, setArchPoints] = useState<Point3[]>([]),
    [panorama, setPanorama] = useState<Panorama | null>(null);
  const [panoramaBusy, setPanoramaBusy] = useState(false),
    [panoramaProgress, setPanoramaProgress] = useState(0);
  const [panoramaError, setPanoramaError] = useState('');
  const currentWorker = useRef<CpuWorkerClient>(null),
    panoramaVersion = useRef(0);
  const axes = useAxesVisibility();
  const loading = Boolean(token || files) && !series && !error;
  const chooseFiles = (value: File[]) => {
    if (value.length) setFiles(value);
  };
  const buildPanorama = useCallback(
    async (client: CpuWorkerClient, points: Point3[] = [], up: Point3 = [0, 0, 1]) => {
      const version = ++panoramaVersion.current;
      setPanoramaBusy(true);
      setPanoramaError('');
      setPanoramaProgress(0);
      try {
        const result = await client.request<Panorama>('panorama', { points, up }, [], percent => {
          if (currentWorker.current === client && version === panoramaVersion.current)
            setPanoramaProgress(percent);
        });
        if (currentWorker.current === client && version === panoramaVersion.current)
          setPanorama(result);
      } catch (failure) {
        if (
          failure.name !== 'AbortError' &&
          currentWorker.current === client &&
          version === panoramaVersion.current
        )
          setPanoramaError(failure.message);
      } finally {
        if (currentWorker.current === client && version === panoramaVersion.current)
          setPanoramaBusy(false);
      }
    },
    []
  );
  useEffect(() => {
    if (!token && !files) return;
    const controller = new AbortController();
    let client: CpuWorkerClient;
    setSeries(null);
    setError('');
    setLoaded(false);
    setNotice('');
    setPanorama(null);
    setPanoramaError('');
    setPanoramaBusy(false);
    setMeasurements([]);
    setArchPoints([]);
    setBasis(IDENTITY_BASIS);
    setThickness(0);
    setFocus(null);
    const report = (value: CpuProgress) => {
      if (!controller.signal.aborted) setProgress(value);
    };
    const run = async () => {
      try {
        client = new CpuWorkerClient();
        currentWorker.current = client;
        setWorker(client);
        const items = await cpuSources(files, token, config, controller.signal, report);
        await loadCpuStudy(
          items,
          client,
          controller.signal,
          report,
          value => {
            if (controller.signal.aborted) return;
            setSeries(value);
            setWindowing(value.window);
            setPoint(
              transform(
                value.geometry.indexToWorld,
                value.geometry.dimensions.map((n, axis) =>
                  axis === 2 ? Math.floor(n / 2) : (n - 1) / 2
                )
              )
            );
          },
          () => {
            if (!controller.signal.aborted) setRevision(value => value + 1);
          }
        );
        if (!controller.signal.aborted) {
          setLoaded(true);
          void buildPanorama(client);
        }
      } catch (failure) {
        if (failure.name !== 'AbortError' && !controller.signal.aborted) {
          setError(failure.message || 'Не удалось загрузить исследование.');
          setSeries(null);
          client?.close();
        }
      }
    };
    void run();
    return () => {
      controller.abort();
      client?.close();
      if (currentWorker.current === client) currentWorker.current = null;
    };
  }, [token, files, config, buildPanorama]);
  useLayoutEffect(() => {
    if (!loading && !error) {
      const host = document.getElementById('orbital-study-loader');
      if (host) host.hidden = true;
    }
  }, [loading, error]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.key !== 'Enter' ||
        event.repeat ||
        event.defaultPrevented ||
        (event.target as HTMLElement)?.closest(
          'input, textarea, select, button, [contenteditable="true"]'
        )
      )
        return;
      event.preventDefault();
      setAxesVisible(!axes);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [axes]);
  const rotate = (id: PlaneId, angle: number) => {
    const normal = planeAxes(id, basis).normal,
      radians = (angle * Math.PI) / 180;
    setBasis(
      basis.map(vector => {
        const dot = vec3.dot(vector, normal),
          crossed = vec3.cross(vec3.create(), normal, vector);
        return vector.map(
          (v, i) =>
            v * Math.cos(radians) +
            crossed[i] * Math.sin(radians) +
            normal[i] * dot * (1 - Math.cos(radians))
        ) as Point3;
      }) as Basis
    );
    setArchPoints([]);
  };
  const showStudy = Boolean(series && worker);
  return (
    <div className="orbital-cpu">
      {(loading || error) && (
        <StudyLoadingScreen
          accessGranted={Boolean(files || series || progress.percent >= 10)}
          progress={progress}
          error={error || null}
          errorTitle="Не удалось загрузить исследование в CPU-режиме"
          errorIntro="CPU-режим не требует WebGL 2. При большой серии ему всё равно нужна свободная оперативная память."
          onBack={() => window.location.assign('/')}
        />
      )}
      <header className="cpu-topbar">
        <a
          href="/"
          title="Вернуться в личный кабинет"
          className="cpu-brand"
        >
          <img
            src={`${window.PUBLIC_URL || '/3dviewer/'}assets/orbital-loading-logo.png`}
            alt="ORBITAL 3D"
          />
        </a>
        <span
          className="cpu-badge"
          title="Срезы рассчитывает процессор. WebGL 2 не используется."
        >
          CPU · совместимый режим
        </span>
        {showStudy && (
          <nav aria-label="Инструменты CPU-просмотрщика">
            {(
              [
                ['crosshair', 'Оси'],
                ['pan', 'Перемещение'],
                ['window', 'Яркость / контраст'],
                ['length', 'Линейка'],
              ] as const
            ).map(([id, name]) => (
              <button
                key={id}
                type="button"
                aria-pressed={tool === id}
                onClick={() => setTool(id)}
              >
                {name}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={axes}
              onClick={() => setAxesVisible(!axes)}
              title="Включить/выключить оси (Enter)"
            >
              {axes ? 'Скрыть оси' : 'Показать оси'}
            </button>
            <button
              type="button"
              onClick={() => setMeasurements([])}
            >
              Очистить линейки
            </button>
          </nav>
        )}
      </header>
      <p className="cpu-info">
        Срезы и панорама работают без WebGL 2. Объёмная 3D-модель и инструменты имплантации доступны
        в основном режиме.
      </p>
      {!showStudy && !loading && !error && (
        <main className="cpu-welcome">
          <h1>Просмотр исследований без WebGL 2</h1>
          <p>
            Включён резервный CPU-режим. Откройте исследование из личного кабинета или выберите
            локальные DICOM-файлы.
          </p>
          <label className="cpu-primary">
            Выбрать DICOM-файлы
            <input
              type="file"
              multiple
              onChange={event => chooseFiles(Array.from(event.target.files || []))}
            />
          </label>
          <label>
            Открыть папку
            <input
              type="file"
              multiple
              {...({ webkitdirectory: '', directory: '' } as any)}
              onChange={event => chooseFiles(Array.from(event.target.files || []))}
            />
          </label>
        </main>
      )}
      {showStudy && (
        <>
          <div className="cpu-settings">
            <span>
              {series.name} · {progress.text}
            </span>
            <label>
              Центр{' '}
              <input
                aria-label="Центр окна"
                type="number"
                value={Math.round(windowing.center)}
                onChange={event => {
                  const center = Number(event.target.value);
                  if (Number.isFinite(center)) setWindowing(value => ({ ...value, center }));
                }}
              />
            </label>
            <label>
              Ширина{' '}
              <input
                aria-label="Ширина окна"
                type="number"
                min="1"
                value={Math.round(windowing.width)}
                onChange={event => {
                  const width = Number(event.target.value);
                  if (Number.isFinite(width) && width >= 1)
                    setWindowing(value => ({ ...value, width }));
                }}
              />
            </label>
            <label>
              Слой{' '}
              <select
                aria-label="Толщина слоя CPU"
                disabled={!loaded}
                value={thickness}
                onChange={event => setThickness(Number(event.target.value))}
              >
                {[0, 1, 3, 5, 10, 20].map(value => (
                  <option
                    key={value}
                    value={value}
                  >
                    {value ? `${value} мм` : 'Один срез'}
                  </option>
                ))}
              </select>
            </label>
            {thickness > 0 && (
              <select
                aria-label="Проекция слоя"
                value={projection}
                onChange={event => setProjection(event.target.value as 'mean' | 'mip')}
              >
                <option value="mean">Среднее</option>
                <option value="mip">MIP</option>
              </select>
            )}
            <button
              type="button"
              onClick={() => {
                setBasis(IDENTITY_BASIS);
                setPoint(series.geometry.center);
                setWindowing(series.window);
                setArchPoints([]);
              }}
            >
              Сбросить плоскости
            </button>
          </div>
          {notice && (
            <p
              className="cpu-notice"
              role="alert"
            >
              {notice}
            </p>
          )}
          <main
            className={`cpu-grid ${focus ? 'has-focus' : ''}`}
            aria-label="Три плоскости и панорама"
          >
            {(['coronal', 'sagittal', 'axial'] as const).map(id => (
              <div
                key={id}
                className={`cpu-cell ${focus === id ? 'is-focused' : ''}`}
                hidden={Boolean(focus && focus !== id)}
              >
                <CpuViewport
                  id={id}
                  geometry={series.geometry}
                  worker={worker}
                  revision={revision}
                  point={point}
                  onPoint={setPoint}
                  basis={basis}
                  window={windowing}
                  setWindow={setWindowing}
                  tool={tool}
                  axes={axes}
                  active={active === id}
                  onActive={() => setActive(id)}
                  onFocus={() => setFocus(value => (value === id ? null : id))}
                  thickness={thickness}
                  projection={projection}
                  measurements={measurements}
                  onMeasure={value => setMeasurements(items => [...items, value])}
                  archPoints={archPoints}
                  onArchPoint={value => setArchPoints(points => [...points, value])}
                  onRotate={rotate}
                  onError={setNotice}
                />
              </div>
            ))}
            <section
              className={`cpu-cell cpu-panorama ${focus === 'panorama' ? 'is-focused' : ''}`}
              hidden={Boolean(focus && focus !== 'panorama')}
            >
              <header>
                <strong>Автопанорама</strong>
                <span>{panoramaBusy ? `${panoramaProgress}%` : 'CPU'}</span>
                <button
                  type="button"
                  disabled={!loaded || panoramaBusy}
                  onClick={() => {
                    setTool('crosshair');
                    void buildPanorama(worker, archPoints, planeAxes('axial', basis).normal);
                  }}
                >
                  {archPoints.length >= 3 ? 'Построить по дуге' : 'Перестроить'}
                </button>
                <button
                  type="button"
                  disabled={!loaded}
                  aria-pressed={tool === 'arch'}
                  onClick={() => {
                    setTool(value => (value === 'arch' ? 'crosshair' : 'arch'));
                    setArchPoints([]);
                  }}
                >
                  Задать дугу
                </button>
                <button
                  type="button"
                  aria-label="Развернуть панораму"
                  onClick={() => setFocus(value => (value === 'panorama' ? null : 'panorama'))}
                >
                  ⛶
                </button>
              </header>
              <div className="cpu-panorama-body">
                {panorama ? (
                  <RasterView
                    raster={panorama.raster}
                    invert={series.geometry.invert}
                    range={{
                      lower: windowing.center - windowing.width / 2,
                      upper: windowing.center + windowing.width / 2,
                    }}
                    orientation={['R', 'L']}
                    label="Панорама CPU: нажмите для перехода к срезам"
                    dragToPosition
                    onPosition={(fraction, vertical) => {
                      const target = panoramaNavigationTarget(panorama, fraction, vertical, {
                        dimensions: series.geometry.dimensions,
                        imageData: {
                          worldToIndex: p => transform(series.geometry.worldToIndex, p),
                        },
                      });
                      if (target) setPoint(clampWorld(series.geometry, target));
                    }}
                  />
                ) : (
                  <p className="cpu-placeholder">
                    {!loaded
                      ? 'Панорама появится после загрузки серии.'
                      : panoramaBusy
                        ? `Построение панорамы: ${panoramaProgress}%`
                        : 'Панорама пока не построена.'}
                  </p>
                )}
              </div>
              {(panoramaError || panorama?.warning || tool === 'arch') && (
                <p
                  className="cpu-notice"
                  role="status"
                >
                  {tool === 'arch'
                    ? `Отметьте дугу на аксиальном срезе (минимум 3 точки). Сейчас: ${archPoints.length}.`
                    : panoramaError || panorama.warning}
                </p>
              )}
            </section>
          </main>
          <footer className="cpu-status">
            <span>
              {loaded
                ? 'Серия загружена полностью'
                : 'Серия ещё загружается: незагруженные участки не отображаются'}
            </span>
            <span>Колесо — срезы · Enter — оси · CPU: без объёмной 3D-модели и имплантации</span>
          </footer>
        </>
      )}
    </div>
  );
}
