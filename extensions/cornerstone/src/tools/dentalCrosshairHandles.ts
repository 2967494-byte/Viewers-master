import type { Types } from '@cornerstonejs/core';

export type CrosshairHandle = {
  kind: 'slab' | 'rotation';
  target: any;
  world: Types.Point3;
  center: Types.Point2;
  angle: number;
  width: number;
  height: number;
};

/** Canvas geometry is shared by rendering and hit testing, including oblique planes. */
export function crosshairHandles(viewport, annotation): CrosshairHandle[] {
  const handles: CrosshairHandle[] = [];
  for (const [key, kind] of [['slabThicknessPoints', 'slab'], ['rotationPoints', 'rotation']] as const) {
    for (const [world, target, start, end] of annotation.data.handles[key] || []) {
      const center = viewport.worldToCanvas(world);
      if (![...center, ...start, ...end].every(Number.isFinite)) continue;
      const angle = Math.atan2(end[1] - start[1], end[0] - start[0]);
      // At minimum thickness the two slab edges overlap. Draw one grip per side.
      const overlap = kind === 'slab' && handles.find(handle => handle.kind === kind &&
        handle.target.id === target.id && Math.hypot(handle.center[0] - center[0], handle.center[1] - center[1]) < 6);
      if (overlap) continue;
      let gripCenter = center, gripAngle = angle, width = 36;
      if (kind === 'rotation') {
        const entries = annotation.data.handles.rotationPoints.filter(entry => entry[1].id === target.id);
        const centers = entries.map(entry => viewport.worldToCanvas(entry[0]));
        // Native rotation grips are paired on opposite rays. Their midpoint is
        // the crosshair pivot; native start/end segments may belong to the other ray.
        const pivot = centers.length > 1
          ? [centers.reduce((sum, p) => sum + p[0], 0) / centers.length,
             centers.reduce((sum, p) => sum + p[1], 0) / centers.length]
          : [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
        const length = Math.hypot(center[0] - pivot[0], center[1] - pivot[1]);
        if (length > 1e-6) {
          const ux = (center[0] - pivot[0]) / length, uy = (center[1] - pivot[1]) / length;
          const extent = Math.max(...entries.flatMap(entry => [entry[2], entry[3]])
            .map(p => (p[0] - center[0]) * ux + (p[1] - center[1]) * uy));
          if (Number.isFinite(extent) && extent > -18) {
            width = extent + 18;
            const offset = (extent - 18) / 2;
            gripCenter = [center[0] + ux * offset, center[1] + uy * offset];
            gripAngle = Math.atan2(uy, ux);
          }
        }
      }
      handles.push({ kind, target, world, center: gripCenter, angle: gripAngle,
        width, height: kind === 'slab' ? 6 : 8 });
    }
  }
  return handles;
}

export function pointInCrosshairHandle(handle: CrosshairHandle, point: number[], padding = 4) {
  const dx = point[0] - handle.center[0], dy = point[1] - handle.center[1];
  const along = dx * Math.cos(handle.angle) + dy * Math.sin(handle.angle);
  const across = -dx * Math.sin(handle.angle) + dy * Math.cos(handle.angle);
  return Math.abs(along) <= handle.width / 2 + padding && Math.abs(across) <= handle.height / 2 + padding;
}

/** Distance to a finite reference-line segment, without changing native edit state. */
export function distanceToCrosshairSegment(point: number[], start: number[], end: number[]) {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Infinity;
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dy);
}

/** Reveal both operations belonging to a line, including its expanded slab edges. */
export function hoveredCrosshairTargets(annotation, handles: CrosshairHandle[], point?: number[]) {
  const targets = new Set<string>();
  if (!point) return targets;
  for (const handle of handles) {
    if (pointInCrosshairHandle(handle, point)) targets.add(handle.target.id);
  }
  const available = new Set(handles.map(handle => handle.target.id));
  for (const key of ['rotationPoints', 'slabThicknessPoints']) {
    for (const [, target, start, end] of annotation.data.handles[key] || []) {
      if (available.has(target.id) && distanceToCrosshairSegment(point, start, end) <= 9)
        targets.add(target.id);
    }
  }
  return targets;
}
