import React, { useEffect, useRef } from 'react';
import { Enums, getEnabledElement } from '@cornerstonejs/core';
import type { VolumeViewport, BaseVolumeViewport, Types } from '@cornerstonejs/core';
import intersectVolumePlane from '../../utils/intersectVolumePlane';

/** Project the axial MPR plane independently of 3D material/VOI. */
export default function VolumeSliceIndicator({ element, sourceViewportId }) {
  const pathRef = useRef<SVGPathElement>(null);
  useEffect(() => {
    if (!element || !sourceViewportId) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const path = pathRef.current;
      if (!path) return;
      path.setAttribute('d', '');
      const enabled = getEnabledElement(element);
      const target = enabled?.viewport as BaseVolumeViewport;
      const source = enabled?.renderingEngine.getViewport(sourceViewportId) as VolumeViewport;
      if (!source || !target || target.type !== Enums.ViewportType.VOLUME_3D) return;
      if (source.type !== Enums.ViewportType.ORTHOGRAPHIC) return;
      if (!source.getVolumeId() || source.getVolumeId() !== target.getVolumeId()) return;
      if (source.getFrameOfReferenceUID() !== target.getFrameOfReferenceUID()) return;
      const data = source.getImageData();
      if (!data) return;
      const corners = Array.from(
        { length: 8 },
        (_, i) =>
          data.imageData.indexToWorld(
            data.dimensions.map((size, axis) => (i & (1 << axis) ? size - 1 : 0)) as Types.Point3
          ) as Types.Point3
      );
      const camera = source.getCamera();
      const points = intersectVolumePlane(corners, camera.focalPoint, camera.viewPlaneNormal);
      const canvas = points.map(point => target.worldToCanvas(point));
      if (canvas.length && canvas.every(point => point.every(Number.isFinite))) {
        path.setAttribute('d', `M ${canvas.map(point => point.join(',')).join(' L ')} Z`);
      }
    };
    const schedule = (event?: Event) => {
      // Capture non-bubbling Cornerstone events, ignoring unrelated viewports.
      if (event && event.target !== element) {
        const source = getEnabledElement(element)?.renderingEngine.getViewport(sourceViewportId);
        if (event.target !== source?.element) return;
      }
      if (!frame) frame = requestAnimationFrame(update);
    };
    const events = [
      Enums.Events.CAMERA_MODIFIED,
      Enums.Events.IMAGE_RENDERED,
      Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME,
    ];
    events.forEach(name => document.addEventListener(name, schedule, true));
    const resize = new ResizeObserver(() => schedule());
    resize.observe(element);
    schedule();
    return () => {
      events.forEach(name => document.removeEventListener(name, schedule, true));
      resize.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [element, sourceViewportId]);
  if (!sourceViewportId) return null;
  return (
    <svg
      aria-label="Положение аксиального среза"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      <path
        ref={pathRef}
        fill="none"
        stroke="#00c800"
        strokeWidth="2"
        style={{ filter: 'drop-shadow(0 0 1px #000)' }}
      />
    </svg>
  );
}
