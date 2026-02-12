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

      const referencedImageId = viewport.getCurrentImageId ? viewport.getCurrentImageId() : '';

      // Satisfy standard interface with proper Point3 types
      const newAnnotation = {
          metadata: {
              toolName: DentalImplantTool.toolName,
              viewPlaneNormal: [normal[0], normal[1], normal[2]] as [number, number, number],
              viewUp: camera.viewUp ? [camera.viewUp[0], camera.viewUp[1], camera.viewUp[2]] as [number, number, number] : undefined,
              FrameOfReferenceUID: viewport.getFrameOfReferenceUID(),
              referencedImageId,
          },
          data: {
              label: '',
              invalidated: true,
              handles: {
                  points: [worldPos, endPoint],
                  activeHandleIndex: null, // No active handle = no drag
                  textBox: {
                      hasMoved: false,
                      worldPosition: [0, 0, 0] as [number, number, number],
                      worldBoundingBox: {
                          topLeft: [0, 0, 0] as [number, number, number],
                          topRight: [0, 0, 0] as [number, number, number],
                          bottomLeft: [0, 0, 0] as [number, number, number],
                          bottomRight: [0, 0, 0] as [number, number, number],
                      },
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

      // 5. Trigger Render Globally (Deferred to prevent Crosshairs collision)
      setTimeout(() => {
          try {
              const enabledElements = cornerstone.getEnabledElements();
              enabledElements.forEach(obj => {
                   const vp = obj.viewport;
                   // Get element from viewport's canvas parent
                   const el = vp?.element;
                   if (vp && el && vp.getFrameOfReferenceUID &&
                       vp.getFrameOfReferenceUID() === viewport.getFrameOfReferenceUID()) {
                       utilities.triggerAnnotationRender(el);
                   }
              });
          } catch(err) {
              console.warn("DentalImplantTool: Deferred render failed", err);
          }
      }, 0);

      // 6. Trigger 3D viewport render so implant appears in skull view
      setTimeout(() => {
          try {
              const enabledElements = cornerstone.getEnabledElements();
              enabledElements.forEach(obj => {
                   const vp = obj.viewport;
                   if (vp && vp.getRenderer) {
                       // This is a 3D viewport - trigger render
                       vp.render();
                   }
              });
          } catch(e) {
              console.warn("DentalImplantTool: 3D render trigger failed", e);
          }
      }, 50);

      // 7. Return annotation
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
  // Interaction Guards: Explicitly block handled resizing, but allow moving
  // ------------------------------------------------------------------------

  handleSelectedCallback(evt, annotation, handle, interactionType = 'mouse') {
      return; // Block handle selection (resizing)
  }


  /**
   * Required for the tool to be selectable/movable.
   * STRICT CHECK: Only allow selection if correct visual elements are close.
   */
  isPointNearToolData(element, annotation, canvasCoords, proximity) {
      const { data } = annotation;
      const { points } = data.handles;
      const enabledElement = getEnabledElement(element);
      const { viewport } = enabledElement;

      // 1. First, check if VISIBLE on this slice
      const vis = this._checkVisibility(viewport, points, data);
      if (!vis.isVisible) return false;

      // 2. Distance Check
      const p1 = viewport.worldToCanvas(points[0]);
      const p2 = viewport.worldToCanvas(points[1]);

      // If End View (Circle), we are basically clicking a point
      if (vis.isEndView) {
          const dist = Math.sqrt(Math.pow(p1[0]-canvasCoords[0], 2) + Math.pow(p1[1]-canvasCoords[1], 2));
          // Radius check
          // const radius = (vis.drawWidthPx || 10) / 2;
          return dist <= (proximity || 6); // Allow clicking center
      }

      // Side View: Check distance to axis
      const distToLine = Math.abs(utilities.math.lineSegment.distanceToPoint(p1, p2, canvasCoords));

      // If we are strictly checking "implant center", check p1
      if (vis.showStartPoint) {
           const distToStart = Math.sqrt(Math.pow(p1[0]-canvasCoords[0], 2) + Math.pow(p1[1]-canvasCoords[1], 2));
           if (distToStart <= (proximity || 6)) return true;
      }

      return distToLine <= (proximity || 6);
  }

  // ------------------------------------------------------------------------
  // Helper: Visibility Logic (Shared)
  // ------------------------------------------------------------------------
  _checkVisibility(viewport, points, data) {
      // Defaults
      const result = {
          isVisible: false,
          isEndView: false,
          showStartPoint: false,
          drawWidthPx: 0,
          distToPlane: 0,
      };


      const viewportType = viewport.type ? viewport.type.toString().toLowerCase() : '';
      // ROBUST 3D CHECK: Check constructor name as fallback
      const is3D =
        viewportType === 'volume3d' ||
        viewportType.includes('3d') ||
        viewport.constructor.name === 'VolumeViewport3D' ||
        (viewport.type && viewport.type === cornerstone.Enums.ViewportType.VOLUME_3D);

      if (is3D) {
          // 3D logic handled separately/always visible if in frustum
          result.isVisible = true;
          return result;
      }

      // 2D Logic
      let implantDiameter = 4;
      if (data.implant?.dimensions?.diameter) implantDiameter = data.implant.dimensions.diameter;
      const rMM = implantDiameter / 2;

      try {
          const camera = viewport.getCamera();
          const { viewPlaneNormal, focalPoint } = camera;

          if (!viewPlaneNormal || !focalPoint) return result;

          // Normalize normal to ensure accurate distance
          const normal = [viewPlaneNormal[0], viewPlaneNormal[1], viewPlaneNormal[2]];
          const lenN = Math.sqrt(normal[0]*normal[0] + normal[1]*normal[1] + normal[2]*normal[2]);
          if (lenN > 0) {
              normal[0] /= lenN;
              normal[1] /= lenN;
              normal[2] /= lenN;
          }

          const p1 = points[0];
          const p2 = points[1];

          // Dists
          const d1 = (
              (p1[0] - focalPoint[0]) * normal[0] +
              (p1[1] - focalPoint[1]) * normal[1] +
              (p1[2] - focalPoint[2]) * normal[2]
          );

          const d2 = (
              (p2[0] - focalPoint[0]) * normal[0] +
              (p2[1] - focalPoint[1]) * normal[1] +
              (p2[2] - focalPoint[2]) * normal[2]
          );

          if (isNaN(d1) || isNaN(d2)) return result;

          const distStartToPlane = Math.abs(d1);
          const distToPlane = (d1 + d2) / 2;
          const intersectsPlane = (d1 * d2) <= 0;

          // Angle
          let angleWithPlane = 0;
          const axis = [p2[0]-p1[0], p2[1]-p1[1], p2[2]-p1[2]];
          const len = Math.sqrt(axis[0]*axis[0] + axis[1]*axis[1] + axis[2]*axis[2]);
          if (len > 0) {
              const dot = Math.abs(
                  (axis[0]*normal[0] + axis[1]*normal[1] + axis[2]*normal[2]) / len
              );
              angleWithPlane = dot;
          }

          // Scale: Calculate pixelsPerMM using a reference point offset
          // This works regardless of viewing angle (unlike projected axis length)
          let pixelsPerMM = 1;
          try {
              // Create a reference point 1mm away from p1 in a direction perpendicular to view normal
              const viewRight = camera.viewUp ? [
                  normal[1] * camera.viewUp[2] - normal[2] * camera.viewUp[1],
                  normal[2] * camera.viewUp[0] - normal[0] * camera.viewUp[2],
                  normal[0] * camera.viewUp[1] - normal[1] * camera.viewUp[0]
              ] : [1, 0, 0];

              const lenR = Math.sqrt(viewRight[0]*viewRight[0] + viewRight[1]*viewRight[1] + viewRight[2]*viewRight[2]);
              if (lenR > 0.001) {
                  // Normalized viewRight direction
                  const refOffset = [viewRight[0]/lenR, viewRight[1]/lenR, viewRight[2]/lenR];
                  // Point 1mm away in screen-horizontal direction
                  const refPoint = [p1[0] + refOffset[0], p1[1] + refOffset[1], p1[2] + refOffset[2]];

                  const p1c = viewport.worldToCanvas(p1);
                  const refC = viewport.worldToCanvas(refPoint);
                  const pxDist = Math.sqrt((p1c[0]-refC[0])*(p1c[0]-refC[0]) + (p1c[1]-refC[1])*(p1c[1]-refC[1]));
                  if (pxDist > 0.1) {
                      pixelsPerMM = pxDist; // Since we offset by 1mm, pxDist = pixels per mm
                  }
              }
          } catch(scaleErr) {
              console.warn("pixelsPerMM calc failed", scaleErr);
          }

          if (angleWithPlane > 0.8) {
              // END VIEW
              // Relaxed check: Visible if intersecting OR if the start head is very close to plane
              // This handles cases where d1 is -0.0001 (behind) relative to camera but effectively on slice
              if (!intersectsPlane && distStartToPlane > 0.5) return result;

              result.isVisible = true;
              result.isEndView = true;
              result.drawWidthPx = implantDiameter * pixelsPerMM;
              result.showStartPoint = true; // Center always on in circle
          } else {
              // SIDE VIEW
              const absDist = Math.abs(distToPlane);
              if (absDist >= rMM) return result; // Hidden

              result.isVisible = true;
              result.isEndView = false;
              // Chord
              const drawWidthMM = 2 * Math.sqrt(Math.max(0, rMM*rMM - absDist*absDist));
              result.drawWidthPx = Math.max(1, drawWidthMM * pixelsPerMM);

              if (distStartToPlane < 0.5) {
                   result.showStartPoint = true;
              }
          }

      } catch (e) {
          console.warn(e);
      }

      return result;
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
      console.log("DentalImplantTool: _update3DActor called", { annotationUID, start, end, diameter });

      const renderer = viewport.getRenderer();
      if (!renderer) {
          console.warn("DentalImplantTool: No renderer for 3D viewport");
          return;
      }

      if (!this.actorMap) this.actorMap = new Map();
      const key = `${annotationUID}-${viewport.id}`;

      let actor = this.actorMap.get(key);

      if (!actor) {
          console.log("DentalImplantTool: Creating new VTK actor for", key);
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

      // Use Shared Visibility Check to ensure consistency with Interaction Logic
      const vis = this._checkVisibility(viewport, points, data);

      if (!vis.isVisible) return;

      const p1 = viewport.worldToCanvas(points[0]);
      const p2 = viewport.worldToCanvas(points[1]);
      const start = p1;
      const end = p2;

      // Draw
      if (vis.isEndView) {
          // Circle
           drawCircle(svgDrawingHelper, annotationUID, 'implant-circle', start, vis.drawWidthPx / 2, {
              color: implantColor,
              lineWidth: 2,
              fillColor: implantColor,
              fillOpacity: 0.2,
          });
          drawCircle(svgDrawingHelper, annotationUID, 'implant-center', start, 1, { color: '#00FFFF', lineWidth: 1, fillColor: '#00FFFF', fillOpacity: 1 });
      } else {
          // Rect
          const rectPoints = this._getRectPoints(start, end, vis.drawWidthPx);
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
          if (vis.showStartPoint) {
              drawCircle(svgDrawingHelper, annotationUID, 'implant-center', start, 1, { color: '#00FFFF', lineWidth: 1, fillColor: '#00FFFF', fillOpacity: 1 });
          }
      }

      renderStatus = true;
    });

    return renderStatus;
  };
}

export default DentalImplantTool;
