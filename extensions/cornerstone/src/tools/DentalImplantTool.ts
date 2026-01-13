import { LengthTool, drawing, annotation, utilities } from '@cornerstonejs/tools';
import { getEnabledElement } from '@cornerstonejs/core';
import * as cornerstone from '@cornerstonejs/core';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkCylinderSource from '@kitware/vtk.js/Filters/Sources/CylinderSource';
import { vec3, mat4 } from 'gl-matrix';

const { drawPolyline, drawLine, drawCircle } = drawing;

/**
 * DentalImplantTool renders a cylinder/implant projection based on the LengthTool's handles.
 * In 3D viewports, it renders a real VTK Cylinder actor.
 * In 2D viewports, it renders annotations (Circle/Rectangle).
 */
class DentalImplantTool extends LengthTool {
  static toolName = 'DentalImplant';
  actorMap: Map<string, any>;

  constructor(toolProps = {}) {
    super(toolProps);
    this.actorMap = new Map();
  }

  /**
   * Overriding addNewAnnotation to completely bypass LengthTool's drag/draw logic.
   * We want a "Stamp" behavior: Click -> Place fixed size -> done.
   */
  addNewAnnotation = (evt) => {
      const eventDetail = evt.detail;
      const { currentPoints, element } = eventDetail;
      const worldPos = currentPoints.world;
      const enabledElement = getEnabledElement(element);
      const { viewport } = enabledElement;

      // 1. Get Configuration
      const { implant } = this.configuration || {};
      const defaultLength = 10;
      let implantLength = defaultLength;

      if (implant) {
          // @ts-ignore
          if (implant.dimensions?.length) {
              // @ts-ignore
              implantLength = implant.dimensions.length;
          }
      }

      // 2. Calculate End Point (Into the screen)
      const camera = viewport.getCamera();
      const { viewPlaneNormal } = camera;

      // Fallback for 3D viewports if viewPlaneNormal is missing or weird?
      const normal = viewPlaneNormal || [0, 0, 1];

      // Direction: Invert normal to go "into" the volume
      const direction = [-normal[0], -normal[1], -normal[2]];

      const endPoint = [
          worldPos[0] + direction[0] * implantLength,
          worldPos[1] + direction[1] * implantLength,
          worldPos[2] + direction[2] * implantLength,
      ];

      // 3. Create Annotation Manually
      const annotationUID = cornerstone.utilities.uuidv4();

      // Satisfy standard interface
      const newAnnotation = {
          metadata: {
              toolName: DentalImplantTool.toolName,
              viewPlaneNormal: [...normal],
              viewUp: camera.viewUp ? [...camera.viewUp] : undefined,
              FrameOfReferenceUID: viewport.getFrameOfReferenceUID(),
              referencedImageId: '',
          },
          data: {
              label: '',
              invalidated: true,
              handles: {
                  points: [worldPos, endPoint],
                  activeHandleIndex: null, // No active handle = no drag
                  textBox: {
                      hasMoved: false,
                      worldPosition: [0, 0, 0],
                      worldBoundingBox: { top: 0, left: 0, bottom: 0, right: 0 },
                  },
              },
              visible: true,
              isLocked: false,
              cachedStats: {},
              implant: implant || {}, // Store config
          },
          annotationUID,
          highlighted: true,
      };

      console.log("DentalImplantTool: Stamped annotation", annotationUID);

      // 4. Add to state
      annotation.state.addAnnotation(newAnnotation, element);

      // 5. Trigger Render
      viewport.render();

      // 6. Return annotation
      return newAnnotation;
  };

  /**
   * CRITICAL: Override getHandleNearImagePoint to return null.
   * This prevents the Tool Manager from detecting handles for resizing,
   * AND prevents the "undefined reading '0'" crash.
   */
  getHandleNearImagePoint(element, annotation, canvasCoords, proximity) {
      return null;
  }

  // ------------------------------------------------------------------------
  // Interaction Guards: Explicitly block standard tool interactions
  // ------------------------------------------------------------------------

  handleSelectedCallback(evt, annotation, handle, interactionType = 'mouse') {
      console.log("DentalImplantTool: Handle selection blocked");
      return;
  }

  mouseDragCallback = (evt, annotation) => {
      return true; // Consume event, do nothing
  }

  touchDragCallback = (evt, annotation) => {
      return true;
  }

  /**
   * Change Cursor on Hover to indicate "Placement" mode
   */
  mouseMoveCallback = (evt, filteredToolAnnotations) => {
        const { element } = evt.detail;
        if (element) {
            element.style.cursor = 'copy';
        }
        return false;
  }

  toolDeactivatedCallback = (evt) => {
       const { element } = evt.detail;
       if (element) element.style.cursor = 'initial';
  }

  // ------------------------------------------------------------------------
  // Helper: Rect Points
  // ------------------------------------------------------------------------
  _getRectPoints(start, end, width) {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length === 0) return [start, start, start, start];

    const ux = dx / length;
    const uy = dy / length;

    // Perpendicular vector
    const px = -uy;
    const py = ux;

    const halfWidth = width / 2;
    const offsetX = px * halfWidth;
    const offsetY = py * halfWidth;

    const p1 = [start[0] + offsetX, start[1] + offsetY];
    const p2 = [end[0] + offsetX, end[1] + offsetY];
    const p3 = [end[0] - offsetX, end[1] - offsetY];
    const p4 = [start[0] - offsetX, start[1] - offsetY];

    return [p1, p2, p3, p4];
  }

  /**
   * Manages the VTK Actor for 3D Viewports
   */
  _update3DActor(viewport, annotationUID, start, end, diameter, colorHex) {
      const renderer = viewport.getRenderer();
      if (!renderer) return;

      if (!this.actorMap) this.actorMap = new Map();
      const key = `${annotationUID}-${viewport.id}`;

      let actor = this.actorMap.get(key);

      if (!actor) {
          // Create Actor
          const cylinderSource = vtkCylinderSource.newInstance({
              resolution: 20,
              height: 1,
              radius: 0.5,
              capping: true,
          });
          const mapper = vtkMapper.newInstance();
          mapper.setInputConnection(cylinderSource.getOutputPort());

          actor = vtkActor.newInstance();
          actor.setMapper(mapper);
          actor.getProperty().setLighting(true);

          renderer.addActor(actor);
          this.actorMap.set(key, actor);
      }

      // Update Color
      const r = parseInt(colorHex.slice(1, 3), 16) / 255;
      const g = parseInt(colorHex.slice(3, 5), 16) / 255;
      const b = parseInt(colorHex.slice(5, 7), 16) / 255;
      actor.getProperty().setColor(r, g, b);
      actor.getProperty().setOpacity(1.0);
      actor.getProperty().setAmbient(0.3);
      actor.getProperty().setDiffuse(0.8);
      actor.getProperty().setSpecular(0.2);

      // Transform
      const vec = vec3.create();
      vec3.subtract(vec, end, start);
      const length = vec3.length(vec);

      if (length < 0.1) return;

      const center = vec3.create();
      vec3.add(center, start, end);
      vec3.scale(center, center, 0.5);

      actor.setScale(1, 1, 1);
      actor.setPosition(0, 0, 0);
      actor.setOrientation(0, 0, 0);

      const direction = vec3.create();
      vec3.normalize(direction, vec);

      const up = vec3.fromValues(0, 1, 0);
      const axis = vec3.create();
      vec3.cross(axis, up, direction);
      const angleRad = Math.acos(vec3.dot(up, direction));

      actor.setPosition(center[0], center[1], center[2]);
      actor.setScale(diameter, length, diameter);

      const mat = mat4.create();
      mat4.translate(mat, mat, center);
      mat4.rotate(mat, mat, angleRad, axis);
      mat4.scale(mat, mat, [diameter, length, diameter]);

      actor.setUserMatrix(mat);

      // Force render of the VTK Window
      const renderWindow = viewport.getRenderWindow ? viewport.getRenderWindow() : null;
      if (renderWindow) renderWindow.render();
      else viewport.render();
  }

  renderAnnotation = (enabledElement, svgDrawingHelper) => {
    let renderStatus = false;
    const { viewport } = enabledElement;
    const { element } = viewport;

    const annotations = annotation.state.getAnnotations(this.getToolName(), element);
    if (!annotations?.length) {
      return renderStatus;
    }

    // ------------------------------------------------------
    // ROBUST 3D DETECTION
    // ------------------------------------------------------
    const viewportType = viewport.type ? viewport.type.toString().toLowerCase() : '';
    const is3D =
        viewportType === 'volume3d' ||
        viewportType.includes('3d') ||
        (viewport.type && viewport.type === cornerstone.Enums.ViewportType.VOLUME_3D);

    annotations.forEach((annot) => {
      const { annotationUID, data } = annot;
      const { points } = data.handles;
      const isVisible = data.visible !== false;
      const isLocked = !!data.isLocked;

      if (isLocked || !isVisible) return;

      // Calc Dimensions
      let implantDiameter = 4; // default mm
      let implantColor = '#FFFF00';
      const implantData = data.implant as any;
      if (implantData) {
          if (implantData.dimensions?.diameter) implantDiameter = implantData.dimensions.diameter;
          if (implantData.color) implantColor = implantData.color;
      }

      // 1. TRY 3D RENDER
      if (is3D) {
          this._update3DActor(viewport, annotationUID, points[0], points[1], implantDiameter, implantColor);
          renderStatus = true;
          return;
      }

      // 2. 2D RENDER (Fallback)

      // Calculate Distances to Plane to determine "Slice Width"
      let distToPlane = 0;
      let intersectsPlane = false;
      let angleWithPlane = 0; // 0 = parallel, 1 = perp

      try {
          const camera = viewport.getCamera();
          const { viewPlaneNormal, focalPoint } = camera;

          if (viewPlaneNormal && focalPoint) {
              const p1 = points[0];
              const p2 = points[1];

              // Normal vector calc
              const d1 = (
                  (p1[0] - focalPoint[0]) * viewPlaneNormal[0] +
                  (p1[1] - focalPoint[1]) * viewPlaneNormal[1] +
                  (p1[2] - focalPoint[2]) * viewPlaneNormal[2]
              );

              const d2 = (
                  (p2[0] - focalPoint[0]) * viewPlaneNormal[0] +
                  (p2[1] - focalPoint[1]) * viewPlaneNormal[1] +
                  (p2[2] - focalPoint[2]) * viewPlaneNormal[2]
              );

              // Average Distance (for width modulation)
              distToPlane = (d1 + d2) / 2;

              // Intersects?
              intersectsPlane = (d1 * d2) <= 0;

              // Angle
              const axis = [p2[0]-p1[0], p2[1]-p1[1], p2[2]-p1[2]];
              const len = Math.sqrt(axis[0]*axis[0] + axis[1]*axis[1] + axis[2]*axis[2]);
              if (len > 0) {
                  const dot = Math.abs(
                      (axis[0]*viewPlaneNormal[0] + axis[1]*viewPlaneNormal[1] + axis[2]*viewPlaneNormal[2]) / len
                  );
                  angleWithPlane = dot; // 1.0 = Perpendicular (End View), 0.0 = Parallel (Side View)
              }
          }
      } catch (err) {
          console.warn("DentalImplantTool: Math failed", err);
      }

      // Convert to Canvas
      const canvasPoints = points.map((p) => viewport.worldToCanvas(p));
      const [start, end] = canvasPoints;

      // Get Scaling (Pixels per MM)
      let pixelsPerMM = 1;
      try {
         const dx = start[0] - end[0];
         const dy = start[1] - end[1];
         const cLen = Math.sqrt(dx*dx + dy*dy);
         const wLen = Math.sqrt(
             Math.pow(points[1][0] - points[0][0], 2) +
             Math.pow(points[1][1] - points[0][1], 2) +
             Math.pow(points[1][2] - points[0][2], 2)
         );
         if (cLen > 0 && wLen > 0) {
              pixelsPerMM = cLen / wLen;
         }
      } catch(e) {}

      const rMM = implantDiameter / 2;
      let drawWidthMM = implantDiameter;

      // -----------------------------------------------------------
      // LOGIC SWITCH
      // -----------------------------------------------------------

      if (angleWithPlane > 0.8) {
          // === END VIEW (Circle) ===
          // Visible if we are cutting through the length
          if (!intersectsPlane) return;

          let drawWidthPx = implantDiameter * pixelsPerMM;

          // Draw Circle
          drawCircle(svgDrawingHelper, annotationUID, 'implant-circle', start, drawWidthPx / 2, {
              color: implantColor,
              lineWidth: 2,
              fillColor: implantColor,
              fillOpacity: 0.2,
          });
          drawCircle(svgDrawingHelper, annotationUID, 'implant-center', start, 1, { color: '#00FFFF', lineWidth: 1, fillColor: '#00FFFF', fillOpacity: 1 });

      } else {
          // === SIDE VIEW (Rect) ===
          // Modulate Width based on distance from axis
          const absDist = Math.abs(distToPlane);

          if (absDist >= rMM) {
              // Outside the cylinder radius -> Hidden
              return;
          }

          // Chord Width = 2 * sqrt(R^2 - d^2)
          drawWidthMM = 2 * Math.sqrt(rMM*rMM - absDist*absDist);

          let drawWidthPx = drawWidthMM * pixelsPerMM;

          // Prevent tiny rendering
          if (drawWidthPx < 1) drawWidthPx = 1;

          const rectPoints = this._getRectPoints(start, end, drawWidthPx);
          drawPolyline(svgDrawingHelper, annotationUID, 'implant-fixture', rectPoints, {
              color: implantColor,
              lineWidth: 2,
              fillColor: implantColor,
              fillOpacity: 0.2,
              closePath: true,
          });
          drawLine(svgDrawingHelper, annotationUID, 'implant-axis', start, end, {
                color: '#00FFFF',
                lineWidth: 2,
                lineDash: [4, 4],
          });
      }

      renderStatus = true;
    });

    return renderStatus;
  };
}

export default DentalImplantTool;
