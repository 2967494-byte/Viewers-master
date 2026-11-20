import React, { useEffect, useRef, useState } from 'react';
import { recordViewerEvent } from '@ohif/core/src/constants/orbitalViewerDiagnostics';
import { cache, Enums, eventTarget, getEnabledElement } from '@cornerstonejs/core';
import type { VolumeViewport } from '@cornerstonejs/core';
import { annotation, Enums as ToolEnums, ToolGroupManager } from '@cornerstonejs/tools';
import type { CrosshairsTool } from '@cornerstonejs/tools';
import RasterView from './RasterView';
import PanoramaImplants from './PanoramaImplants';
import { getPanoramaSession, type PanoramaSession } from './panoramaSession';
import { START_AUTOMATIC_PANORAMA } from './ManualPanorama';
import { displayedMprCrosshair, nearestPanoramaPosition } from './panoramaCrosshair';
import { panoramaNavigationTarget } from './panoramaNavigation';
import './ManualPanorama.css';
import { skullVolumeId } from '../../utils/lazySkull';

/** Overlay the existing 3D viewport, preserving its renderer, camera and focus controls. */
export default function AutomaticPanoramaPane({ element, sourceViewportId = 'mpr-axial' }) {
  const [showPanorama, setShowPanorama] = useState(true);
  const [skullState, setSkullState] = useState('');
  const [state, setState] = useState<PanoramaSession['state']>(null);
  const [sliceOffset, setSliceOffset] = useState(0);
  const [position, setPosition] = useState<number>();
  const [navigationEnabled, setNavigationEnabled] = useState(false);
  const sessionRef = useRef<PanoramaSession>(null);
  useEffect(() => {
    if (!element) return;
    const changed = (event: CustomEvent) => setSkullState(event.detail);
    element.addEventListener('orbital:skull-state', changed);
    return () => element.removeEventListener('orbital:skull-state', changed);
  }, [element]);

  useEffect(() => {
    recordViewerEvent('panorama', { value: showPanorama ? 'automatic' : 'volume' });
    // React has removed the covering panorama before requesting the first visible skull frame.
    if (element && !showPanorama) getEnabledElement(element)?.viewport?.render?.();
  }, [element, showPanorama]);
  useEffect(() => {
    if (!element) return;
    let currentVolume = null;
    let unsubscribe = () => {};
    let frame = 0;
    const check = () => {
      frame = 0;
      const enabled = getEnabledElement(element);
      const source = enabled?.renderingEngine?.getViewport(sourceViewportId) as VolumeViewport;
      const volumeId = skullVolumeId(enabled?.viewport);
      const volume =
        volumeId && source?.getVolumeId?.() === volumeId ? cache.getVolume(volumeId) : null;
      setNavigationEnabled(
        ToolGroupManager.getToolGroupForViewport(
          sourceViewportId,
          enabled?.renderingEngine?.id
        )?.getActivePrimaryMouseButtonTool() === 'Crosshairs'
      );
      if (volume !== currentVolume) {
        unsubscribe();
        sessionRef.current?.cancel();
        currentVolume = volume;
        sessionRef.current = volume ? getPanoramaSession(volume) : null;
        setState(sessionRef.current?.state || null);
        setShowPanorama(true);
        setSkullState('');
        setPosition(undefined);
        if (sessionRef.current) {
          const session = sessionRef.current;
          unsubscribe = session.subscribe(() => {
            setState(session.state);
            schedule();
          });
        } else unsubscribe = () => {};
      }
      const session = sessionRef.current;
      if (!session || !volume.loadStatus.loaded) return;
      if (session.state.status === 'idle') {
        // Loading-completed may arrive before every slice is cached. Once ready, camera
        // motion only updates the marker; it need not scan the list of cached slices again.
        if (volume.imageIds.some(id => !cache.getImage(id)?.voxelManager)) return;
        try {
          void session.ensure(source, volume).catch(() => {});
        } catch (error) {
          setState({ status: 'error', progress: 0, snapshot: null, error: error.message });
        }
      }
      const snapshot = session.state.snapshot;
      if (snapshot) {
        const viewports = ['mpr-coronal', 'mpr-sagittal', sourceViewportId].map(
          id => enabled.renderingEngine.getViewport(id) as VolumeViewport
        );
        const sameStudy = viewports.every(
          viewport =>
            viewport?.getVolumeId?.() === volumeId &&
            viewport.getFrameOfReferenceUID?.() === source.getFrameOfReferenceUID?.()
        );
        const toolGroup = ToolGroupManager.getToolGroupForViewport(
          sourceViewportId,
          enabled.renderingEngine.id
        );
        const crosshairs = toolGroup?.getToolInstance('Crosshairs') as CrosshairsTool;
        // toolCenter starts at [0,0,0]; only trust it once this axial viewport
        // has its own crosshair annotation. Do not take another viewport's tool.
        const initialized =
          crosshairs &&
          annotation.state
            .getAnnotations('Crosshairs', source.element)
            ?.some(item => item.data?.viewportId === sourceViewportId);
        const crosshairWorld = sameStudy
          ? displayedMprCrosshair(
              viewports.map(viewport => viewport.getCamera()),
              initialized ? crosshairs.toolCenter : undefined
            )
          : null;
        const focal = crosshairWorld || source.getCamera().focalPoint;
        setSliceOffset(
          snapshot.up.reduce((sum, v, i) => sum + v * (focal[i] - snapshot.points[0][i]), 0)
        );
        setPosition(
          crosshairWorld
            ? nearestPanoramaPosition(snapshot.curve, snapshot.up, crosshairWorld)
            : undefined
        );
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    const toolChanged = () => {
      const enabled = getEnabledElement(element);
      setNavigationEnabled(
        ToolGroupManager.getToolGroupForViewport(
          sourceViewportId,
          enabled?.renderingEngine?.id
        )?.getActivePrimaryMouseButtonTool() === 'Crosshairs'
      );
      schedule();
    };
    const documentEvents = [
      Enums.Events.IMAGE_RENDERED,
      Enums.Events.CAMERA_MODIFIED,
      Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME,
    ];
    const loadingEvents = [
      Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED,
      Enums.Events.IMAGE_VOLUME_MODIFIED,
      Enums.Events.VOLUME_CACHE_VOLUME_REMOVED,
    ].filter(Boolean);
    documentEvents.forEach(name => document.addEventListener(name, schedule, true));
    loadingEvents.forEach(name => eventTarget.addEventListener(name, schedule));
    eventTarget.addEventListener(ToolEnums.Events.CROSSHAIR_TOOL_CENTER_CHANGED, schedule);
    window.addEventListener('orbital:dental-tool-changed', toolChanged);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
      sessionRef.current?.cancel();
      sessionRef.current = null;
      documentEvents.forEach(name => document.removeEventListener(name, schedule, true));
      loadingEvents.forEach(name => eventTarget.removeEventListener(name, schedule));
      eventTarget.removeEventListener(ToolEnums.Events.CROSSHAIR_TOOL_CENTER_CHANGED, schedule);
      window.removeEventListener('orbital:dental-tool-changed', toolChanged);
    };
  }, [element, sourceViewportId]);
  const snapshot = state?.snapshot;
  const navigate = (fraction: number, vertical: number) => {
    const enabled = getEnabledElement(element);
    const engine = enabled?.renderingEngine;
    const source = engine?.getViewport(sourceViewportId) as VolumeViewport;
    const volumeId = skullVolumeId(enabled?.viewport);
    const volume = volumeId && cache.getVolume(volumeId);
    const current = sessionRef.current;
    const group = engine && ToolGroupManager.getToolGroupForViewport(sourceViewportId, engine.id);
    if (
      !snapshot ||
      current?.state.snapshot !== snapshot ||
      !volume?.loadStatus.loaded ||
      getPanoramaSession(volume) !== current ||
      group?.getActivePrimaryMouseButtonTool() !== 'Crosshairs'
    )
      return;
    const viewports = ['mpr-coronal', 'mpr-sagittal', sourceViewportId].map(
      id => engine.getViewport(id) as VolumeViewport
    );
    if (
      !source ||
      !viewports.every(
        viewport =>
          viewport?.getVolumeId?.() === volumeId &&
          viewport.getFrameOfReferenceUID?.() === source.getFrameOfReferenceUID?.()
      )
    )
      return;
    const tool = group.getToolInstance('Crosshairs') as CrosshairsTool;
    const target = panoramaNavigationTarget(snapshot, fraction, vertical, source.getImageData());
    if (target && tool) {
      tool.setToolCenter(target);
      // Render our own selection immediately, including while the GPU is still
      // rendering the three new slices. Other MPR gestures keep the event path above.
      setPosition(nearestPanoramaPosition(snapshot.curve, snapshot.up, target));
      setSliceOffset(
        snapshot.up.reduce((sum, v, i) => sum + v * (target[i] - snapshot.points[0][i]), 0)
      );
    }
  };
  const toggleTitle = showPanorama ? 'Показать череп' : 'Показать автопанораму';
  return (
    <>
      {!showPanorama && ['waiting', 'error'].includes(skullState) && (
        <div className="automatic-panorama-message" role="status" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {skullState === 'error' ? 'Не удалось подготовить череп. Можно продолжить работу со срезами и панорамой.' : 'Подготавливаем череп…'}
        </div>
      )}
      {showPanorama && (
        <div
          className="automatic-panorama-pane"
          aria-label="Окно автопанорамы"
        >
          <header>
            Автопанорама{' '}
            <span>
              {snapshot
                ? `${snapshot.curve.length.toFixed(1)} мм · слой ${snapshot.thickness} мм`
                : ''}
            </span>
          </header>
          <div className="automatic-panorama-image">
            {snapshot ? (
              <RasterView
                raster={snapshot.raster}
                range={snapshot.range}
                sharpness={snapshot.sharpness}
                label="Автопанорама исследования"
                position={position}
                onPosition={navigationEnabled ? navigate : undefined}
                dragToPosition
                overlay={
                  <PanoramaImplants
                    element={element}
                    sourceViewportId={sourceViewportId}
                    snapshot={snapshot}
                  />
                }
                orientation={
                  snapshot.points[0][0] < snapshot.points[snapshot.points.length - 1][0]
                    ? ['R', 'L']
                    : ['L', 'R']
                }
                slicePosition={
                  ((snapshot.raster.topMm ?? snapshot.raster.heightMm / 2) - sliceOffset) /
                  snapshot.raster.heightMm
                }
              />
            ) : (
              <div
                className="automatic-panorama-message"
                role={state?.status === 'error' ? 'alert' : 'status'}
              >
                {state?.status === 'error'
                  ? `${state.error} Откройте редактор или переключитесь на череп.`
                  : state?.status === 'working'
                    ? `Строим автопанораму… ${state.progress}%`
                    : 'Автопанорама появится после загрузки снимка…'}
              </div>
            )}
          </div>
          {snapshot?.coverageWarning && (
            <div className="manual-coverage-warning">
              Проверьте дугу в редакторе: {snapshot.coverageWarning}
            </div>
          )}
        </div>
      )}
      <button
        className="mpr-focus-button mpr-panorama-toggle"
        title={toggleTitle}
        aria-label={toggleTitle}
        aria-pressed={!showPanorama}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => {
          event.stopPropagation();
          setShowPanorama(value => !value);
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width="19"
          height="19"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {showPanorama ? (
            <>
              <path d="M7 15c-2-1-3-3-3-6a8 8 0 0 1 16 0c0 3-1 5-3 6v5H7z M9 20v-3m3 3v-3m3 3v-3" />
              <circle
                cx="8"
                cy="10"
                r="1.5"
              />
              <circle
                cx="16"
                cy="10"
                r="1.5"
              />
              <path d="m11 14 1-2 1 2" />
            </>
          ) : (
            <>
              <rect
                x="2"
                y="5"
                width="20"
                height="14"
                rx="2"
              />
              <path d="M5 15c0-10 14-10 14 0 M5 12v4m4-6v6m3-7v7m3-6v6m4-4v4" />
            </>
          )}
        </svg>
      </button>
      <button
        className="mpr-focus-button mpr-panorama-edit"
        title="Открыть редактор автопанорамы"
        aria-label="Открыть редактор автопанорамы"
        onPointerDown={event => event.stopPropagation()}
        onClick={event => {
          event.stopPropagation();
          window.dispatchEvent(new Event(START_AUTOMATIC_PANORAMA));
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width="19"
          height="19"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 18C3 5 15 3 19 10 M12 19l7-7 3 3-7 7-4 1z M17 14l3 3" />
          <circle
            cx="3"
            cy="18"
            r="1.5"
          />
          <circle
            cx="8"
            cy="7"
            r="1.5"
          />
        </svg>
      </button>
    </>
  );
}
