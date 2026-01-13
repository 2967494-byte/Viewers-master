import { AnnotationDisplayTool } from '@cornerstonejs/tools';
import { getEnabledElement, eventTarget, Enums } from '@cornerstonejs/core';

/**
 * FocalPointDotTool - draws a small cyan dot at the camera's focal point.
 * Uses AnnotationDisplayTool with forced re-render on camera modification.
 */
class FocalPointCrossTool extends AnnotationDisplayTool {
  static toolName = 'FocalPointCross';

  private _initialized: boolean = false;

  constructor(
    toolProps = {},
    defaultToolProps = {
      supportedInteractionTypes: [],
      configuration: {
        color: 'rgb(0, 255, 255)', // Cyan
        radius: 5,
      },
    }
  ) {
    super(toolProps, defaultToolProps);
  }

  onSetToolActive(): void {
    this._subscribeToEvents();
  }

  onSetToolEnabled(): void {
    this._subscribeToEvents();
  }

  onSetToolPassive(): void {
    this._subscribeToEvents();
  }

  onSetToolDisabled(): void {
    this._unsubscribeFromEvents();
  }

  private _subscribeToEvents(): void {
    if (!this._initialized) {
      eventTarget.addEventListener(
        Enums.Events.CAMERA_MODIFIED,
        this._onCameraModified as EventListener
      );
      this._initialized = true;
    }
  }

  private _unsubscribeFromEvents(): void {
    eventTarget.removeEventListener(
      Enums.Events.CAMERA_MODIFIED,
      this._onCameraModified as EventListener
    );
    this._initialized = false;
  }

  private _onCameraModified = (evt: any): void => {
    const { element } = evt.detail || {};

    if (!element) {
      return;
    }

    const enabledElement = getEnabledElement(element);
    if (!enabledElement) {
      return;
    }

    const { renderingEngine, viewport } = enabledElement;

    // Force re-render of this viewport
    if (renderingEngine && viewport) {
      renderingEngine.renderViewport(viewport.id);
    }
  };

  // Override renderAnnotation to always draw the dot
  renderAnnotation(enabledElement: any, svgDrawingHelper: any): boolean {
    const { viewport } = enabledElement;

    if (!viewport) {
      return false;
    }

    // Get the Camera Focal Point
    const camera = viewport.getCamera();
    const focalPoint = camera?.focalPoint;

    if (!focalPoint) {
      return false;
    }

    // Convert to Canvas Coordinates
    let canvasPos;
    try {
      canvasPos = viewport.worldToCanvas(focalPoint);
    } catch (e) {
      return false;
    }

    if (!canvasPos) {
      return false;
    }

    const cx = canvasPos[0];
    const cy = canvasPos[1];

    // Get configuration
    const { color, radius } = this.configuration;

    // Create unique ID for this viewport's marker
    const viewportId = viewport.id || 'default';
    const svgNodeId = `focal-dot-${viewportId}`;

    const svgns = 'http://www.w3.org/2000/svg';
    const existingElement = svgDrawingHelper.getSvgNode(svgNodeId);

    const attributes: Record<string, string> = {
      cx: String(cx),
      cy: String(cy),
      r: String(radius),
      fill: color,
      id: svgNodeId,
    };

    if (existingElement) {
      Object.keys(attributes).forEach((key) => {
        existingElement.setAttribute(key, attributes[key]);
      });
      svgDrawingHelper.setNodeTouched(svgNodeId);
    } else {
      const circle = document.createElementNS(svgns, 'circle');
      Object.keys(attributes).forEach((key) => {
        circle.setAttribute(key, attributes[key]);
      });
      svgDrawingHelper.appendNode(circle, svgNodeId);
    }

    return true;
  }
}

export default FocalPointCrossTool;
