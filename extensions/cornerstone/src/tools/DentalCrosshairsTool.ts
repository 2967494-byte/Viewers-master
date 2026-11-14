import { CrosshairsTool, state, utilities as toolUtilities } from '@cornerstonejs/tools';
import { CONSTANTS, getEnabledElement, getRenderingEngine, utilities } from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';
import { getAxesVisible } from '@ohif/core/src/constants/orbitalAxes';
import { crosshairHandles, distanceToCrosshairSegment, hoveredCrosshairTargets, pointInCrosshairHandle } from './dentalCrosshairHandles';

// These are Cornerstone Crosshairs' native operation IDs.
const ROTATE = 2, SLAB = 3;
const minimumSlab = CONSTANTS.RENDERING_DEFAULTS.MINIMUM_SLAB_THICKNESS;

const finitePoint = point => point?.length === 3 && point.every(Number.isFinite);

/** Retain Cornerstone's operations and annotation name; improve their affordances. */
export default class DentalCrosshairsTool extends CrosshairsTool {
  static toolName = CrosshairsTool.toolName;
  private hoverPoints = new WeakMap<HTMLElement, { point: number[]; signature: string }>();

  constructor(...args: ConstructorParameters<typeof CrosshairsTool>) {
    super(...args);
    // Crosshair motion must change slice positions, never pan other images to
    // chase an off-screen cursor. Deliberate middle-button Pan remains available.
    this.configuration.autoPan = { ...this.configuration.autoPan, enabled: false };
    const onCameraModified = this.onCameraModified;
    let synchronizing = false;
    this.onCameraModified = event => {
      if (synchronizing) return onCameraModified(event);
      const enabled = getEnabledElement(event.detail.element);
      const viewport = enabled?.viewport;
      const current =
        viewport &&
        this.filterInteractableAnnotationsForElement(
          viewport.element,
          this._getAnnotations(enabled)
        )[0];
      let center: Types.Point3;
      if (current && finitePoint(this.toolCenter)) {
        const camera = viewport.getCamera();
        const { cameraPosition, cameraFocalPoint } = current.metadata;
        const { position, focalPoint, viewPlaneNormal } = camera;
        if (
          [cameraPosition, cameraFocalPoint, position, focalPoint, viewPlaneNormal].every(
            finitePoint
          )
        ) {
          const length = Math.hypot(...viewPlaneNormal);
          const delta = position.map((v, i) => v - cameraPosition[i]);
          const focalDelta = focalPoint.map((v, i) => v - cameraFocalPoint[i]);
          const normal = viewPlaneNormal.map(v => v / (length || 1));
          const along = delta.reduce((sum, v, i) => sum + v * normal[i], 0);
          const inPlane = Math.hypot(...delta.map((v, i) => v - along * normal[i]));
          if (
            length > 1e-8 &&
            utilities.isEqual(delta, focalDelta, 1e-3) &&
            Math.abs(along) >= 1e-2 &&
            inPlane > 1e-3 &&
            this._getReferenceLineControllable(viewport.id) &&
            this._getReferenceLineDraggableRotatable(viewport.id)
          ) {
            // Native Crosshairs adds the entire camera displacement to its center.
            // A combined pan+scroll (e.g. framing the panorama editor) must move
            // the shared point only onto the new slice, preserving its in-plane position.
            const offset = normal.reduce(
              (sum, v, i) => sum + v * (focalPoint[i] - this.toolCenter[i]),
              0
            );
            center = this.toolCenter.map((v, i) => v + normal[i] * offset) as Types.Point3;
          }
        }
      }
      onCameraModified(event);
      if (center) {
        synchronizing = true;
        try {
          // Use Cornerstone's own setter so all three image planes, annotations
          // and the panorama receive the same physical point. Avoid recursive repairs.
          this.setToolCenter(center);
        } finally {
          synchronizing = false;
        }
      }
    };
    // Cornerstone defines renderAnnotation on the instance, not its prototype.
    const isPointNearTool = this.isPointNearTool;
    this.isPointNearTool = (element, annotation, canvasCoords, proximity) =>
      getAxesVisible() && this.navigationActive() && isPointNearTool(element, annotation, canvasCoords, proximity);
    const render = this.renderAnnotation;
    this.renderAnnotation = (enabledElement, helper) => {
      if (!getAxesVisible()) return false;
      const result = render(enabledElement, helper);
      if (!this.configuration.explainHandles) return result;
      const current = this.filterInteractableAnnotationsForElement(
        enabledElement.viewport.element,
        this._getAnnotations(enabledElement)
      )[0];
      if (!current) return result;
      for (let line = 0; line < 3; line++) {
        for (const group of ['', 'One', 'Two']) {
          for (let index = 0; index < 4; index++) {
            const node = helper.getSvgNode(
              `${current.annotationUID}::handle::hg-${line}${group}-index-${index}`
            );
            if (node) {
              // Replace native circles/squares with grips whose geometry also
              // defines the hit area. Keep native slab/rotation calculations.
              node.style.display = 'none';
            }
          }
        }
      }
      const handles = this.navigationActive() ? this.getDentalHandles(enabledElement.viewport, current) : [];
      const hover = this.hoverPoints.get(enabledElement.viewport.element)?.point;
      const hoveredTargets = hoveredCrosshairTargets(current, handles, hover);
      handles.forEach((handle, index) => {
        const dragging = state.isInteractingWithTool &&
          current.data.activeViewportIds?.includes(handle.target.id) &&
          current.data.handles.activeOperation === (handle.kind === 'slab' ? SLAB : ROTATE);
        if (!dragging && !hoveredTargets.has(handle.target.id)) return;
        const hash = `${current.annotationUID}::dental-grip::${index}`;
        let node = helper.getSvgNode(hash);
        if (!node) {
          node = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          helper.appendNode(node, hash);
        }
        const color = handle.kind === 'slab' ? this._getReferenceLineColor(handle.target.id) : '#c79cff';
        node.setAttribute('x', String(-handle.width / 2));
        node.setAttribute('y', String(-handle.height / 2));
        node.setAttribute('width', String(handle.width));
        node.setAttribute('height', String(handle.height));
        node.setAttribute('rx', '2');
        node.setAttribute('transform', `translate(${handle.center.join(' ')}) rotate(${handle.angle * 180 / Math.PI})`);
        node.setAttribute('fill', color || '#bfc8d4');
        node.setAttribute('fill-opacity', '0.45');
        node.setAttribute('stroke', color || '#bfc8d4');
        node.setAttribute('stroke-width', '1');
        node.setAttribute('data-dental-crosshair-handle', handle.kind);
        node.setAttribute('data-target-viewport', handle.target.id);
        node.setAttribute('aria-label', handle.kind === 'slab'
          ? 'Толщина слоя: колесо — изменить, щелчок — сбросить'
          : 'Поворот плоскости: тяните фиолетовый маркер');
        node.style.filter = 'drop-shadow(0 0 2px #000)';
        helper.setNodeTouched(hash);
      });
      if (handles.length && (current.highlighted || current.data.handles.activeOperation)) {
        const hash = `${current.annotationUID}::dental-handle-help`;
        let text = helper.getSvgNode(hash);
        if (!text) {
          text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          helper.appendNode(text, hash);
        }
        text.setAttribute('x', '40');
        text.setAttribute('class', 'dental-crosshair-help');
        text.setAttribute('y', String(enabledElement.viewport.element.clientHeight - 16));
        text.setAttribute('fill', '#fff');
        text.setAttribute('font-size', '12');
        text.setAttribute('font-family', 'sans-serif');
        text.setAttribute('paint-order', 'stroke');
        text.setAttribute('stroke', '#000');
        text.setAttribute('stroke-width', '4');
        const selected = handles.find(handle => handle.kind === 'slab' && current.data.activeViewportIds?.includes(handle.target.id));
        text.textContent = current.data.handles.activeOperation === SLAB && selected
          ? `${selected.target.getSlabThickness() <= minimumSlab ? 'Один слой' : `Толщина: ${selected.target.getSlabThickness().toFixed(1)} мм`} · колесо: изменить · щелчок: сбросить`
          : 'Линия: сдвиг · цветной маркер: толщина · фиолетовый маркер: поворот';
        helper.setNodeTouched(hash);
      }
      return result;
    };
  }

  _applyDeltaShiftToSelectedViewportCameras(engine, annotations, delta) {
    const data = annotations.length && engine.getViewport(annotations[0].data.viewportId)?.getImageData?.();
    const image = data?.imageData;
    if (!image?.worldToIndex || !finitePoint(this.toolCenter)) {
      return super._applyDeltaShiftToSelectedViewportCameras(engine, annotations, delta);
    }
    // Clip the movement along its original direction in voxel coordinates. This
    // also works for oriented volumes/oblique planes and preserves the drag plane.
    const movement = [0, 0, 0];
    annotations.forEach(annotation => {
      const normal = engine.getViewport(annotation.data.viewportId).getCamera().viewPlaneNormal;
      const distance = normal.reduce((sum, value, i) => sum + value * delta[i], 0);
      normal.forEach((value, i) => { movement[i] += value * distance; });
    });
    const start = image.worldToIndex(this.toolCenter);
    const end = image.worldToIndex(this.toolCenter.map((value, i) => value + movement[i]));
    const dimensions = data.dimensions;
    let fraction = 1;
    // Matrix round-off can put an edge point a tiny fraction beyond its voxel.
    // Keep clipping subsequent drags rather than treating that as an outside start.
    if (start.every((value, i) => value >= -1e-3 && value <= dimensions[i] - 1 + 1e-3)) {
      start.forEach((value, i) => {
        const step = end[i] - value;
        if (step > 0) fraction = Math.min(fraction, (dimensions[i] - 1 - value) / step);
        else if (step < 0) fraction = Math.min(fraction, -value / step);
      });
    }
    return super._applyDeltaShiftToSelectedViewportCameras(engine, annotations,
      delta.map(value => value * Math.max(0, fraction)));
  }

  getHandleNearImagePoint(element, annotation, canvasCoords, proximity) {
    if (!getAxesVisible() || !this.navigationActive()) return null;
    if (this.configuration.explainHandles) {
      const { viewport } = getEnabledElement(element);
      const handle = this.getDentalHandles(viewport, annotation).find(handle =>
        pointInCrosshairHandle(handle, canvasCoords));
      if (!handle) return null;
      annotation.data.handles.activeOperation = handle.kind === 'slab' ? SLAB : ROTATE;
      annotation.data.activeViewportIds = [handle.target.id];
      (this as any).editData = { annotation };
      return handle.world;
    }
    return super.getHandleNearImagePoint(
      element,
      annotation,
      canvasCoords,
      this.configuration.explainHandles ? Math.max(proximity, 12) : proximity
    );
  }

  getDentalHandles(viewport, annotation) {
    return crosshairHandles(viewport, annotation).filter(handle =>
      this._getReferenceLineControllable(handle.target.id) && (handle.kind === 'slab'
        ? this._getReferenceLineSlabThicknessControlsOn(handle.target.id)
        : this._getReferenceLineDraggableRotatable(handle.target.id)));
  }

  private navigationActive() {
    // Passive reference lines remain visible while another tool measures, but
    // must not select a slab/rotation handle ahead of that tool's first click.
    return !this.mode || this.mode === 'Active';
  }

  getSlabHandleAtPoint(element, point) {
    if (!getAxesVisible() || !this.navigationActive() || !this.configuration.explainHandles) return;
    const enabled = getEnabledElement(element);
    const current = this.filterInteractableAnnotationsForElement(element, this._getAnnotations(enabled))[0];
    return current && this.getDentalHandles(enabled.viewport, current).find(handle =>
      handle.kind === 'slab' && pointInCrosshairHandle(handle, point));
  }

  updateDentalHover(element, point: number[] | null) {
    const enabled = getEnabledElement(element);
    if (!enabled) return;
    const current = this.filterInteractableAnnotationsForElement(element, this._getAnnotations(enabled))[0];
    const signature = point && current && this.navigationActive() && getAxesVisible()
      ? [...hoveredCrosshairTargets(current, this.getDentalHandles(enabled.viewport, current), point)].sort().join(',') : '';
    const previousHover = this.hoverPoints.get(element);
    const previous = previousHover?.signature || '';
    if (point) this.hoverPoints.set(element, { point, signature });
    else this.hoverPoints.delete(element);
    if (signature !== previous || (signature && point && previousHover &&
      Math.hypot(point[0] - previousHover.point[0], point[1] - previousHover.point[1]) > 0.1))
      toolUtilities.triggerAnnotationRender(element);
  }

  getSlabWheelTarget(element, point) {
    if (!getAxesVisible() || !this.navigationActive() || !this.configuration.explainHandles) return;
    const enabled = getEnabledElement(element);
    const current = this.filterInteractableAnnotationsForElement(element, this._getAnnotations(enabled))[0];
    if (!current) return;
    const handles = this.getDentalHandles(enabled.viewport, current);
    const hit = handles.find(handle => pointInCrosshairHandle(handle, point));
    if (hit) return hit.kind === 'slab' ? hit.target : undefined;
    // The central reference axis stays in place as slab boundaries expand.
    // Exclude its intersection, where two different planes would be ambiguous.
    const center = enabled.viewport.worldToCanvas(this.toolCenter);
    if (Math.hypot(point[0] - center[0], point[1] - center[1]) < 24) return;
    let selected, nearest = 9;
    for (const [, target, start, end] of current.data.handles.rotationPoints || []) {
      if (!this._getReferenceLineControllable(target.id) || !this._getReferenceLineSlabThicknessControlsOn(target.id)) continue;
      const distance = distanceToCrosshairSegment(point, start, end);
      if (distance < nearest) { nearest = distance; selected = target; }
    }
    return selected;
  }

  changeSlabThickness(target, direction: number | 'reset') {
    if (!getAxesVisible() || !this._getReferenceLineControllable(target.id) ||
      !this._getReferenceLineSlabThicknessControlsOn(target.id)) return false;
    const current = target.getSlabThickness();
    if (!Number.isFinite(current)) return false;
    // One millimetre per wheel notch; the native minimum restores single-slice
    // composite rendering rather than leaving MIP enabled at an apparent zero.
    const stepped = direction === 'reset' ? minimumSlab : direction > 0
      ? Math.floor(current + 1e-6) + 1 : Math.ceil(current - 1e-6) - 1;
    const next = Math.min(Math.max(100, current), Math.max(minimumSlab, stepped));
    if (next !== current) {
      this.setSlabThickness(target, next);
      // VolumeViewport.setSlabThickness clamps to 0.1 mm, whereas its actual
      // initial single-slice state is 0.05 mm. Use its public reset for that state.
      if (next === minimumSlab) target.resetSlabThickness();
      for (const { viewportId, renderingEngineId } of this._getViewportsInfo()) {
        getRenderingEngine(renderingEngineId)?.getViewport(viewportId)?.render();
      }
    }
    return true;
  }

}
