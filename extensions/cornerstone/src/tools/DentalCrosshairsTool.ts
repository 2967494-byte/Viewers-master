import { CrosshairsTool } from '@cornerstonejs/tools';
import { getEnabledElement, utilities } from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';

const finitePoint = point => point?.length === 3 && point.every(Number.isFinite);

/** Retain Cornerstone's operations and annotation name; improve their affordances. */
export default class DentalCrosshairsTool extends CrosshairsTool {
  static toolName = CrosshairsTool.toolName;

  constructor(...args: ConstructorParameters<typeof CrosshairsTool>) {
    super(...args);
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
    const render = this.renderAnnotation;
    this.renderAnnotation = (enabledElement, helper) => {
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
              const label =
                node.tagName === 'circle'
                  ? 'Поворот плоскости — тяните круг'
                  : 'Толщина слоя — тяните квадрат поперёк линии';
              node.setAttribute('stroke-width', '2.5');
              node.style.filter = 'drop-shadow(0 0 2px #000)';
              node.setAttribute('aria-label', label);
            }
          }
        }
      }
      if (current.highlighted || current.data.handles.activeOperation) {
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
        text.setAttribute('font-size', '13');
        text.setAttribute('font-family', 'sans-serif');
        text.setAttribute('paint-order', 'stroke');
        text.setAttribute('stroke', '#000');
        text.setAttribute('stroke-width', '4');
        text.textContent = 'Линия: сдвиг  ·  ○: поворот  ·  □: толщина слоя';
        helper.setNodeTouched(hash);
      }
      return result;
    };
  }

  getHandleNearImagePoint(element, annotation, canvasCoords, proximity) {
    return super.getHandleNearImagePoint(
      element,
      annotation,
      canvasCoords,
      this.configuration.explainHandles ? Math.max(proximity, 12) : proximity
    );
  }
}
