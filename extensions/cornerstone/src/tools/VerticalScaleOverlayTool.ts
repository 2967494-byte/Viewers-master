import { AnnotationDisplayTool, utilities, annotation as annotationModule } from '@cornerstonejs/tools';
import { eventTarget, Enums, getEnabledElement } from '@cornerstonejs/core';

// Get utilities
const { triggerAnnotationRender } = utilities;
const { state: annotationState } = annotationModule;

class VerticalScaleOverlayTool extends AnnotationDisplayTool {
  private _cameraModifiedHandler: any = null;

  constructor(
    toolProps = {},
    defaultToolProps = {
      supportedInteractionTypes: [],
      configuration: {
        shadow: true,
        preventHandleOutsideImage: false,
      },
    }
  ) {
    super(toolProps, defaultToolProps);
    this._initCameraListener();
  }

  private _initCameraListener() {
    if (!this._cameraModifiedHandler) {
      this._cameraModifiedHandler = (evt: any) => {
        const { element } = evt.detail || {};
        if (!element) return;

        // Trigger annotation render
        if (triggerAnnotationRender) {
          triggerAnnotationRender(element);
        }
      };

      eventTarget.addEventListener(
        Enums.Events.CAMERA_MODIFIED,
        this._cameraModifiedHandler
      );
    }
  }

  private _getCrosshairsCenter(element: HTMLDivElement): number[] | null {
    // Get Crosshairs annotations
    const crosshairAnnotations = annotationState.getAnnotations('Crosshairs', element);

    if (crosshairAnnotations && crosshairAnnotations.length > 0) {
      const annotation = crosshairAnnotations[0];
      // CrosshairsTool stores centerPointWorld in its annotation data
      const centerPoint = annotation.data?.centerPointWorld ||
                          annotation.data?.handles?.toolCenter ||
                          annotation.data?.toolCenter;
      if (centerPoint) {
        return centerPoint;
      }
    }
    return null;
  }

  renderAnnotation(enabledElement, svgDrawingHelper) {
    const { viewport } = enabledElement;
    const { element } = viewport;

    // ============ SCALE BAR RENDERING ============

    // Matvey: Scale bar is now rendered by custom overlay in index.tsx
    // We only use this tool for the focal point dot now.
    const renderScale = false;

    if (renderScale) {
        const canvasP1 = [0, 0];
        const canvasP2 = [0, 100];

        const worldP1 = viewport.canvasToWorld(canvasP1);
        const worldP2 = viewport.canvasToWorld(canvasP2);

        const distanceMm = Math.sqrt(
          Math.pow(worldP1[0] - worldP2[0], 2) +
          Math.pow(worldP1[1] - worldP2[1], 2) +
          Math.pow(worldP1[2] - worldP2[2], 2)
        );

        if (distanceMm) {
            const pixelsPerMm = 100 / distanceMm;

            let displayMm = 50;
            const heightLimit = element.clientHeight * 0.8;

            if (30 * pixelsPerMm <= heightLimit) {
                displayMm = 30;
            } else if (50 * pixelsPerMm <= heightLimit) {
                displayMm = 50;
            } else if (10 * pixelsPerMm <= heightLimit) {
                displayMm = 10;
            } else {
                displayMm = 10;
            }

            const displayPx = displayMm * pixelsPerMm;

            const marginRight = 20;
            const x = element.clientWidth - marginRight;
            const centerY = element.clientHeight / 2;
            const topY = centerY - displayPx / 2;
            const bottomY = centerY + displayPx / 2;

            const scaleColor = 'rgb(255, 255, 0)';
            const lineWidth = 2;
            const tickLength = 8;

            // Main vertical line
            this._renderOrUpdateElement(svgDrawingHelper, 'scaleLine', 'line', {
              x1: x,
              y1: topY,
              x2: x,
              y2: bottomY,
              stroke: scaleColor,
              'stroke-width': lineWidth,
            });

            // Horizontal tick marks
            const ticksPerCm = displayMm / 10;
            const pixelsPerCm = 10 * pixelsPerMm;

            for (let i = 0; i <= ticksPerCm; i++) {
              const tickY = topY + (i * pixelsPerCm);
              const isEndTick = i === 0 || i === ticksPerCm;
              const currentTickLength = isEndTick ? tickLength : tickLength * 0.6;

              this._renderOrUpdateElement(svgDrawingHelper, `scaleTick-${i}`, 'line', {
                x1: x - currentTickLength,
                y1: tickY,
                x2: x,
                y2: tickY,
                stroke: scaleColor,
                'stroke-width': lineWidth,
              });
            }

            // Text label
            this._renderOrUpdateText(svgDrawingHelper, 'scaleText', {
              x: x - tickLength - 5,
              y: bottomY + 5,
              fill: scaleColor,
              'font-family': 'Arial',
              'font-size': '12px',
              'text-anchor': 'end',
              'dominant-baseline': 'hanging',
            }, `${displayMm / 10} cm`);
        }
    }

    // ============ FOCAL POINT DOT RENDERING ============

    // Try to get crosshairs center point from annotation
    const crosshairsCenter = this._getCrosshairsCenter(element);

    // Fallback to camera focal point if crosshairs center not available
    const worldPoint = crosshairsCenter || viewport.getCamera()?.focalPoint;

    if (worldPoint) {
      try {
        const canvasPos = viewport.worldToCanvas(worldPoint);

        if (canvasPos && !isNaN(canvasPos[0]) && !isNaN(canvasPos[1])) {
          this._renderOrUpdateElement(svgDrawingHelper, 'focalPointDot', 'circle', {
            cx: canvasPos[0],
            cy: canvasPos[1],
            r: 1,
            fill: 'rgb(0, 255, 255)',
          });
        }
      } catch (e) {
        // Ignore conversion errors
      }
    }

    return true;
  }

  private _renderOrUpdateElement(
    svgDrawingHelper: any,
    uid: string,
    tagName: string,
    attributes: Record<string, any>
  ) {
    const svgns = 'http://www.w3.org/2000/svg';
    const existingElement = svgDrawingHelper.getSvgNode(uid);

    const allAttributes = { ...attributes, id: uid };

    if (existingElement) {
      Object.keys(allAttributes).forEach(key => {
        existingElement.setAttribute(key, String(allAttributes[key]));
      });
      svgDrawingHelper.setNodeTouched(uid);
    } else {
      const newElement = document.createElementNS(svgns, tagName);
      Object.keys(allAttributes).forEach(key => {
        newElement.setAttribute(key, String(allAttributes[key]));
      });
      svgDrawingHelper.appendNode(newElement, uid);
    }
  }

  private _renderOrUpdateText(
    svgDrawingHelper: any,
    uid: string,
    attributes: Record<string, any>,
    content: string
  ) {
    const svgns = 'http://www.w3.org/2000/svg';
    const existingElement = svgDrawingHelper.getSvgNode(uid);

    const allAttributes = { ...attributes, id: uid };

    if (existingElement) {
      Object.keys(allAttributes).forEach(key => {
        existingElement.setAttribute(key, String(allAttributes[key]));
      });
      existingElement.textContent = content;
      svgDrawingHelper.setNodeTouched(uid);
    } else {
      const newElement = document.createElementNS(svgns, 'text');
      Object.keys(allAttributes).forEach(key => {
        newElement.setAttribute(key, String(allAttributes[key]));
      });
      newElement.textContent = content;
      svgDrawingHelper.appendNode(newElement, uid);
    }
  }
}

VerticalScaleOverlayTool.toolName = 'VerticalScaleOverlay';
export default VerticalScaleOverlayTool;
