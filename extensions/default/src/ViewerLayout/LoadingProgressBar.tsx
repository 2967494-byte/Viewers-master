import React, { useEffect, useRef, useState } from 'react';
import { cache, eventTarget, EVENTS as csEvents, Enums } from '@cornerstonejs/core';
import { useSystem } from '@ohif/core';
import './LoadingProgressBar.css';

/** Loading follows the viewport boundary and never consumes toolbar space. */
export default function LoadingProgressBar() {
  const { servicesManager } = useSystem();
  const root = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({ percent: 0, visible: false, done: false, loaded: 0, total: 0, failed: 0 });
  useEffect(() => {
    const { displaySetService, viewportGridService } = servicesManager.services;
    if (!displaySetService) return;
    let timer: ReturnType<typeof setTimeout>;
    let total = 0;
    let expected = new Set<string>();
    let seen = new Set<string>();
    let failed = new Set<string>();
    let identities = new Set<string>();
    let finished = false;
    let disposed = false;
    const publish = (percent: number, done = false) => {
      if (disposed) return;
      clearTimeout(timer);
      finished = done;
      setState({ percent, done, visible: true, loaded: seen.size, total, failed: failed.size });
      if (done) timer = setTimeout(() => setState(s => ({ ...s, visible: false })), 2000);
    };
    const update = () => {
      if (!total) return;
      const loaded = expected.size ? [...seen].filter(id => expected.has(id)).length : seen.size;
      publish(Math.min(100, Math.floor((loaded * 100) / total)), loaded >= total);
    };
    const refreshSets = () => {
      let sets =
        displaySetService.getActiveDisplaySets?.() ?? displaySetService.activeDisplaySets ?? [];
      const viewports = viewportGridService?.getState?.()?.viewports;
      if (viewports?.size) {
        const displayed = new Set([...viewports.values()].flatMap((viewport: any) => viewport.displaySetInstanceUIDs || []));
        sets = sets.filter(ds => displayed.has(ds.displaySetInstanceUID));
      }
      const nextIdentities = new Set<string>(
        sets.map(ds => ds.displaySetInstanceUID || ds.SeriesInstanceUID)
      );
      const changedStudy =
        identities.size &&
        nextIdentities.size &&
        ![...nextIdentities].some(id => identities.has(id));
      if (changedStudy) {
        seen = new Set();
        failed = new Set();
        finished = false;
      }
      identities = nextIdentities;
      expected = new Set(
        sets.flatMap(
          ds => ds.imageIds || ds.images?.map(image => image.imageId).filter(Boolean) || []
        )
      );
      seen = new Set([...seen].filter(id => expected.has(id)));
      failed = new Set([...failed].filter(id => expected.has(id)));
      total = Math.max(
        expected.size,
        sets.reduce((sum, ds) => sum + (ds.numImageFrames || ds.images?.length || 0), 0)
      );
      expected.forEach(id => {
        if (cache.getImage(id)) seen.add(id);
      });
      if (total) update();
      else {
        clearTimeout(timer);
        setState({ percent: 0, visible: false, done: false, loaded: 0, total: 0, failed: 0 });
      }
    };
    const imageLoaded = event => {
      const id = event.detail?.image?.imageId;
      if (!id || seen.has(id) || !expected.has(id)) return;
      seen.add(id);
      failed.delete(id);
      if (!finished) update();
    };
    const volumeProgress = event => {
      const volume = cache.getVolume(event.detail?.volumeId);
      const ids = volume?.imageIds || [];
      if (ids.length && !expected.size) refreshSets();
      // A completion event also fires after failed frames. Only actual cached
      // pixels/full-resolution frames count; errors must never show green 100%.
      ids.forEach((id, i) => {
        if (!expected.has(id)) return;
        if (cache.getImage(id) || volume?.cachedFrames?.[i] === Enums.ImageQualityStatus.FULL_RESOLUTION) {
          seen.add(id);
          failed.delete(id);
        }
      });
      if (ids.some(id => expected.has(id))) update();
    };
    const imageFailed = event => {
      const id = event.detail?.imageId;
      if (!expected.has(id) || seen.has(id)) return;
      failed.add(id);
      update();
    };
    refreshSets();
    const subscription = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_ADDED,
      refreshSets
    );
    const changed = displaySetService.EVENTS.ACTIVE_DISPLAY_SETS_CHANGED;
    const activeSubscription = changed ? displaySetService.subscribe(changed, refreshSets) : null;
    const gridSubscriptions = ['GRID_STATE_CHANGED', 'VIEWPORTS_READY', 'LAYOUT_CHANGED']
      .map(name => viewportGridService?.EVENTS?.[name])
      .filter(Boolean)
      .map(event => viewportGridService.subscribe(event, refreshSets));
    eventTarget.addEventListener(csEvents.IMAGE_LOADED, imageLoaded);
    eventTarget.addEventListener(csEvents.IMAGE_VOLUME_LOADING_COMPLETED, volumeProgress);
    if (csEvents.IMAGE_VOLUME_MODIFIED) eventTarget.addEventListener(csEvents.IMAGE_VOLUME_MODIFIED, volumeProgress);
    const failureEvents = [csEvents.IMAGE_LOAD_FAILED, csEvents.IMAGE_LOAD_ERROR].filter(Boolean);
    failureEvents.forEach(event => eventTarget.addEventListener(event, imageFailed));
    return () => {
      disposed = true;
      clearTimeout(timer);
      subscription.unsubscribe();
      activeSubscription?.unsubscribe();
      gridSubscriptions.forEach(subscription => subscription.unsubscribe());
      eventTarget.removeEventListener(csEvents.IMAGE_LOADED, imageLoaded);
      eventTarget.removeEventListener(csEvents.IMAGE_VOLUME_LOADING_COMPLETED, volumeProgress);
      if (csEvents.IMAGE_VOLUME_MODIFIED) eventTarget.removeEventListener(csEvents.IMAGE_VOLUME_MODIFIED, volumeProgress);
      failureEvents.forEach(event => eventTarget.removeEventListener(event, imageFailed));
    };
  }, [servicesManager]);
  if (!state.visible) return null;
  return (
    <div
      ref={root}
      className={['orbital-load-boundary', state.done && 'is-done'].filter(Boolean).join(' ')}
      role="progressbar"
      aria-label={state.done ? 'Открытые серии загружены' : 'Загрузка открытых серий'}
      aria-valuetext={`Загружено ${state.loaded} из ${state.total} срезов${state.failed ? `, ошибок: ${state.failed}` : ''}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={state.percent}
    >
      <div className="orbital-load-track" />
      <div
        className="orbital-load-front"
        style={{ width: `${state.percent}%` }}
      >
        <div className="orbital-load-line" />
        <span className="orbital-load-dot" />
        <span
          className={['orbital-load-percent', state.percent < 8 && 'at-start']
            .filter(Boolean)
            .join(' ')}
        >
          {state.done ? '✓ 100%' : `${state.percent}%`} · {state.loaded}/{state.total}
          {state.failed > 0 && ` · ошибок: ${state.failed}`}
        </span>
      </div>
    </div>
  );
}
