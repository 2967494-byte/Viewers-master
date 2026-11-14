import React, { useEffect, useMemo, useState } from 'react';
import { cache, Enums, eventTarget, getEnabledElement } from '@cornerstonejs/core';
import type { BaseVolumeViewport, VolumeViewport } from '@cornerstonejs/core';
import { annotation, Enums as ToolEnums } from '@cornerstonejs/tools';
import { getPanoramaSession, type PanoramaSnapshot } from './panoramaSession';
import {
  preparePanoramaImplantGeometry,
  projectImplantToPanorama,
} from './panoramaImplantGeometry';

type Shape = {
  uid: string;
  color: string;
  selected: boolean;
  contours: number[][][];
  label: string;
};

/** Read-only CPR overlay of the existing annotations, scoped to the actual displayed volume. */
function PanoramaImplants({
  element,
  sourceViewportId,
  snapshot,
}: {
  element: HTMLDivElement;
  sourceViewportId: string;
  snapshot: PanoramaSnapshot;
}) {
  const geometry = useMemo(() => preparePanoramaImplantGeometry(snapshot), [snapshot]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  useEffect(() => {
    if (!element || !geometry) {
      setShapes([]);
      return;
    }
    let frame = 0,
      signature = '';
    const projected = new Map<string, { signature: string; shape: Shape | null }>();
    const sync = () => {
      frame = 0;
      const enabled = getEnabledElement(element);
      const source = enabled?.renderingEngine?.getViewport(sourceViewportId) as VolumeViewport;
      const volumeId = (enabled?.viewport as BaseVolumeViewport)?.getVolumeId?.();
      const volume = volumeId && cache.getVolume(volumeId);
      const valid =
        volume &&
        source?.getVolumeId?.() === volumeId &&
        getPanoramaSession(volume).state.snapshot === snapshot;
      const items = valid
        ? (annotation.state.getAnnotations('DentalImplant', source.element) || [])
            .filter(
              item =>
                item.metadata?.toolName === 'DentalImplant' &&
                item.metadata.dentalVolumeId === volumeId &&
                item.metadata.FrameOfReferenceUID === source.getFrameOfReferenceUID() &&
                item.data?.visible !== false &&
                annotation.visibility.isAnnotationVisible(item.annotationUID)
            )
            .map(item => ({
              uid: item.annotationUID,
              points: item.data.handles?.points,
              diameter: item.data.implant?.dimensions?.diameter || 4,
              color: item.data.implant?.color || '#FFFF00',
              selected: annotation.selection.isAnnotationSelected(item.annotationUID),
              name: item.data.implant?.name || 'Имплант',
            }))
        : [];
      const next = JSON.stringify(items);
      if (next === signature) return;
      signature = next;
      const live = new Set(items.map(item => item.uid));
      for (const uid of projected.keys()) if (!live.has(uid)) projected.delete(uid);
      setShapes(
        items.flatMap(item => {
          if (item.points?.length !== 2) return [];
          const signature = JSON.stringify(item);
          const previous = projected.get(item.uid);
          if (previous?.signature === signature) return previous.shape ? [previous.shape] : [];
          const { contours } = projectImplantToPanorama(
            geometry,
            item.points[0],
            item.points[1],
            item.diameter
          );
          const shape = contours.length
            ? {
                uid: item.uid,
                color: item.color,
                selected: item.selected,
                contours,
                label: item.name,
              }
            : null;
          projected.set(item.uid, { signature, shape });
          return shape ? [shape] : [];
        })
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };
    const events = [
      ToolEnums.Events.ANNOTATION_ADDED,
      ToolEnums.Events.ANNOTATION_COMPLETED,
      ToolEnums.Events.ANNOTATION_MODIFIED,
      ToolEnums.Events.ANNOTATION_REMOVED,
      ToolEnums.Events.ANNOTATION_VISIBILITY_CHANGE,
      ToolEnums.Events.ANNOTATION_SELECTION_CHANGE,
      Enums.Events.VOLUME_CACHE_VOLUME_REMOVED,
    ].filter(Boolean);
    const windowEvents = [
      'orbital:implant-updated',
      'orbital:implant-drag',
      'orbital:implant-placed',
    ];
    events.forEach(name => eventTarget.addEventListener(name, schedule));
    windowEvents.forEach(name => window.addEventListener(name, schedule));
    document.addEventListener(Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME, schedule, true);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      events.forEach(name => eventTarget.removeEventListener(name, schedule));
      windowEvents.forEach(name => window.removeEventListener(name, schedule));
      document.removeEventListener(Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME, schedule, true);
    };
  }, [element, sourceViewportId, snapshot, geometry]);
  return (
    <g
      data-panorama-implants="true"
      pointerEvents="none"
    >
      {shapes.map(shape => (
        <g
          key={shape.uid}
          data-panorama-implant={shape.uid}
        >
          <title>{shape.label} · проекция в слое панорамы</title>
          {shape.contours.map((contour, index) => (
            <polygon
              key={index}
              points={contour.map(p => p.join(',')).join(' ')}
              stroke={shape.color}
              fill={shape.color}
              fillOpacity="0.18"
              strokeWidth={shape.selected ? 2.25 : 1.5}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      ))}
    </g>
  );
}
export default React.memo(PanoramaImplants);
