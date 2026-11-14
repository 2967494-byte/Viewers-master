import React, { useEffect, useState } from 'react';
import { cache, Enums, getEnabledElement } from '@cornerstonejs/core';
import type { VolumeViewport } from '@cornerstonejs/core';

import ViewportImageScrollbar from './ViewportImageScrollbar';
import CustomizableViewportOverlay from './CustomizableViewportOverlay';
import ViewportOrientationMarkers from './ViewportOrientationMarkers';
import ViewportImageSliceLoadingIndicator from './ViewportImageSliceLoadingIndicator';
import installCrosshairSlabControls from '../../utils/crosshairSlabControls';
import installViewportImageFilter from '../../utils/viewportImageFilter';

function CornerstoneOverlays(props: withAppTypes) {
  const { viewportId, element, scrollbarHeight, servicesManager } = props;
  const { cornerstoneViewportService } = servicesManager.services;
  const [imageSliceData, setImageSliceData] = useState({
    imageIndex: 0,
    numberOfSlices: 0,
  });
  const [viewportData, setViewportData] = useState(null);
  const [displaySampling, setDisplaySampling] = useState<string | null>(null);

  useEffect(() => {
    if (element) return installCrosshairSlabControls(element);
  }, [element]);

  useEffect(() => {
    if (element) return installViewportImageFilter(element);
  }, [element]);

  useEffect(() => {
    if (!element) return;
    const update = () => {
      const viewport = getEnabledElement(element)?.viewport as VolumeViewport | undefined;
      const volumeId = viewport?.type === Enums.ViewportType.ORTHOGRAPHIC ? viewport.getVolumeId() : null;
      const volume = volumeId ? cache.getVolume(volumeId) as any : null;
      const sampling = volume?.orbitalDisplaySampling;
      const step = sampling ? volume.spacing[2] * sampling.sourceDepth / sampling.displayDepth : null;
      setDisplaySampling(sampling ? sampling.reason === 'filtering'
        ? 'без сглаживания между вокселями'
        : `шаг по Z ${step.toFixed(2).replace('.', ',')} мм` : null);
    };
    element.addEventListener(Enums.Events.IMAGE_RENDERED, update);
    element.addEventListener(Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME, update);
    document.addEventListener('orbital:volume-display-mode', update);
    update();
    return () => {
      element.removeEventListener(Enums.Events.IMAGE_RENDERED, update);
      element.removeEventListener(Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME, update);
      document.removeEventListener('orbital:volume-display-mode', update);
    };
  }, [element, viewportData]);

  useEffect(() => {
    const { unsubscribe } = cornerstoneViewportService.subscribe(
      cornerstoneViewportService.EVENTS.VIEWPORT_DATA_CHANGED,
      props => {
        if (props.viewportId !== viewportId) {
          return;
        }

        setViewportData(props.viewportData);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [viewportId]);

  if (!element) {
    return null;
  }

  if (viewportData) {
    const viewportInfo = cornerstoneViewportService.getViewportInfo(viewportId);

    if (viewportInfo?.viewportOptions?.customViewportProps?.hideOverlays) {
      return null;
    }
  }

  return (
    <div className="noselect">
      {displaySampling && (
        <div
          title="Детализация отображения снижена. Исходные слои и пространственные координаты сохранены."
          style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
            color: '#bcc4cf', background: '#14191fe6', borderRadius: 4, padding: '3px 7px',
            fontSize: 11, whiteSpace: 'nowrap', zIndex: 2 }}
        >
          Облегчённое отображение · {displaySampling}
        </div>
      )}
      <ViewportImageScrollbar
        viewportId={viewportId}
        viewportData={viewportData}
        element={element}
        imageSliceData={imageSliceData}
        setImageSliceData={setImageSliceData}
        scrollbarHeight={scrollbarHeight}
        servicesManager={servicesManager}
      />

      <CustomizableViewportOverlay
        imageSliceData={imageSliceData}
        viewportData={viewportData}
        viewportId={viewportId}
        servicesManager={servicesManager}
        element={element}
      />

      <ViewportImageSliceLoadingIndicator
        viewportData={viewportData}
        element={element}
      />

      <ViewportOrientationMarkers
        imageSliceData={imageSliceData}
        element={element}
        viewportData={viewportData}
        servicesManager={servicesManager}
        viewportId={viewportId}
      />
    </div>
  );
}

export default CornerstoneOverlays;
