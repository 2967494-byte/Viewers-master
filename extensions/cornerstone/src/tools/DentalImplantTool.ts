import { LengthTool, drawing, annotation, utilities } from '@cornerstonejs/tools';
import * as cornerstone from '@cornerstonejs/core';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkCylinderSource from '@kitware/vtk.js/Filters/Sources/CylinderSource';
import {
  implantEndpoints,
  implantMatrix,
  implantPlaneSection,
  rotateImplantInPlane,
} from './implantGeometry';
import type { Point3 } from './dentalGeometry';

export const IMPLANT_EDIT = 'orbital:implant-edit';
export const IMPLANT_UPDATED = 'orbital:implant-updated';
const volumeId = (viewport: any): string | undefined => viewport?.getVolumeId?.();
const is3D = viewport => String(viewport.type).toLowerCase().includes('3d');
const copyPoints = item => item.data.handles.points.map(p => [...p] as Point3);
const distance2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** One world-space finite cylinder shared by MPR, gestures, editor and the cached 3D actor. */
class DentalImplantTool extends LengthTool {
  static toolName = 'DentalImplant';
  actorMap = new Map<string, any>();
  pipelineMap = new Map<string, { source: any; mapper: any; signature: string; viewport: any }>();
  private gesture?: {
    original: Point3[];
    mode: 'move' | 'rotate';
    pointer: Point3;
    normal: Point3;
    element: HTMLElement;
  };
  private removeMoveListeners?: () => void;
  private dragOutside = false;

  constructor(toolProps = {}) {
    super(toolProps);
    this.isPointNearTool = (element, item, canvas, proximity) =>
      this.isPointNearToolData(element, item, canvas, proximity);
    const begin = this.toolSelectedCallback,
      move = this._dragCallback,
      finish = this._endCallback;
    this.toolSelectedCallback = (evt, item) => {
      if (annotation.locking.isAnnotationLocked(item.annotationUID)) return;
      const viewport = cornerstone.getEnabledElement(evt.detail.element)?.viewport;
      if (!viewport) return;
      this.cancelGesture();
      annotation.selection?.setAnnotationSelected(item.annotationUID);
      if (is3D(viewport)) {
        this.openEditor(evt.detail.element, item);
        return;
      }
      begin(evt, item);
      this.startGroupRecording?.();
      this.dragOutside = false;
      this.gesture = {
        original: copyPoints(item),
        mode: 'move',
        pointer: evt.detail.currentPoints?.world,
        normal: [...viewport.getCamera().viewPlaneNormal] as Point3,
        element: evt.detail.element,
      };
      const cancel = () => this.cancelGesture();
      const key = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      };
      const disabled = event => {
        if (event.detail?.element === evt.detail.element) cancel();
      };
      for (const name of ['blur', 'pointercancel', 'lostpointercapture'])
        window.addEventListener(name, cancel);
      window.addEventListener('keydown', key);
      evt.detail.element.addEventListener(
        cornerstone.Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME,
        cancel
      );
      cornerstone.eventTarget?.addEventListener(
        cornerstone.Enums.Events.ELEMENT_DISABLED,
        disabled
      );
      this.removeMoveListeners = () => {
        for (const name of ['blur', 'pointercancel', 'lostpointercapture'])
          window.removeEventListener(name, cancel);
        window.removeEventListener('keydown', key);
        evt.detail.element.removeEventListener(
          cornerstone.Enums.Events.VOLUME_VIEWPORT_NEW_VOLUME,
          cancel
        );
        cornerstone.eventTarget?.removeEventListener(
          cornerstone.Enums.Events.ELEMENT_DISABLED,
          disabled
        );
      };
      this.dragFeedback(true);
    };
    this._dragCallback = evt => {
      if (!this.editData || !this.gesture) return;
      const item = this.editData.annotation;
      if (this.gesture.mode === 'rotate') {
        const world = evt.detail.currentPoints.world;
        if (!world) return;
        this.createMemo(evt.detail.element, item);
        const [start, end] = this.gesture.original;
        item.data.handles.points = [
          [...start],
          rotateImplantInPlane(start, end, this.gesture.pointer, world, this.gesture.normal),
        ];
        item.invalidated = true;
        this.editData.hasMoved = true;
      } else move(evt);
      this.setDragFeedback(evt);
      this.renderLinkedViews();
    };
    this._endCallback = evt => {
      if (!this.editData) return;
      const { annotation: item, hasMoved } = this.editData,
        mode = this.gesture?.mode;
      this.removeMoveListeners?.();
      this.removeMoveListeners = undefined;
      this.setDragFeedback(evt);
      const shouldDelete = mode !== 'rotate' && hasMoved && this.dragOutside;
      finish(evt);
      evt.detail.element.classList.remove('implant-drag-delete');
      this.gesture = undefined;
      if (shouldDelete && !annotation.locking.isAnnotationLocked(item.annotationUID)) {
        this.createMemo(evt.detail.element, item, { deleting: true });
        annotation.state.removeAnnotation(item.annotationUID);
        this.doneEditMemo();
      }
      this.dragOutside = false;
      this.endGroupRecording?.();
      this.dragFeedback(false, !!shouldDelete);
      this.renderLinkedViews();
      if (!shouldDelete) this.openEditor(evt.detail.element, item);
      this.notify(item);
    };
    this.cancel = () => {
      const uid = this.editData?.annotation?.annotationUID;
      this.cancelGesture();
      return uid;
    };
  }

  private cancelGesture() {
    if (!this.editData || !this.gesture) return;
    const { annotation: item } = this.editData,
      { original, element } = this.gesture;
    item.data.handles.points = original;
    item.invalidated = true;
    this.editData.hasMoved = false;
    this._endCallback({ detail: { element, currentPoints: { canvas: [0, 0] } } } as any);
  }
  private dragFeedback(dragging: boolean, deleted = false) {
    window.dispatchEvent(
      new CustomEvent('orbital:implant-drag', {
        detail: { dragging, outside: this.dragOutside, deleted },
      })
    );
  }
  private setDragFeedback(evt) {
    const { element, currentPoints } = evt.detail,
      rect = element.getBoundingClientRect(),
      [x, y] = currentPoints.canvas;
    this.dragOutside =
      this.gesture?.mode !== 'rotate' && (x < 0 || y < 0 || x > rect.width || y > rect.height);
    element.classList.toggle('implant-drag-delete', this.dragOutside);
    this.dragFeedback(true);
  }
  private renderLinkedViews() {
    cornerstone.getEnabledElements().forEach(({ viewport }) => {
      if (viewport?.element) utilities.triggerAnnotationRender(viewport.element);
    });
  }
  private notify(item) {
    window.dispatchEvent(
      new CustomEvent(IMPLANT_UPDATED, { detail: { annotationUID: item.annotationUID } })
    );
  }
  openEditor(element, item) {
    const viewport = cornerstone.getEnabledElement(element)?.viewport;
    if (
      !viewport ||
      (annotation.state.getAnnotation && annotation.state.getAnnotation(item.annotationUID) !== item) ||
      annotation.locking.isAnnotationLocked(item.annotationUID) ||
      (item.metadata?.dentalVolumeId && item.metadata.dentalVolumeId !== volumeId(viewport))
    )
      return;
    window.dispatchEvent(new CustomEvent(IMPLANT_EDIT, { detail: { element, item, tool: this } }));
  }

  /** Apply one editor transaction; history, MPR and 3D consume the same endpoints/model. */
  updateImplant(element, item, points: Point3[], model) {
    const viewport = cornerstone.getEnabledElement(element)?.viewport;
    if (
      this.editData ||
      !viewport ||
      annotation.locking.isAnnotationLocked(item.annotationUID) ||
      (item.metadata.dentalVolumeId && item.metadata.dentalVolumeId !== volumeId(viewport)) ||
      (annotation.state.getAnnotation &&
        annotation.state.getAnnotation(item.annotationUID) !== item) ||
      points.length !== 2 ||
      !points.flat().every(Number.isFinite) ||
      !model?.dimensions ||
      ![model.dimensions.length, model.dimensions.diameter].every(Number.isFinite) ||
      model.dimensions.length <= 0 ||
      model.dimensions.diameter <= 0 ||
      Math.abs(Math.hypot(...points[1].map((v, i) => v - points[0][i])) - model.dimensions.length) >
        1e-5
    )
      return false;
    this.createMemo(element, item);
    item.data.handles.points = points.map(p => [...p]);
    item.data.implant = model;
    item.invalidated = true;
    this.doneEditMemo();
    this.renderLinkedViews();
    this.notify(item);
    return true;
  }
  filterInteractableAnnotationsForElement(element, items) {
    const viewport = cornerstone.getEnabledElement(element)?.viewport;
    if (!viewport) return [];
    return items.filter(
      (item: any) =>
        (!item.metadata.dentalVolumeId || item.metadata.dentalVolumeId === volumeId(viewport)) &&
        this._checkVisibility(viewport, item.data.handles.points, item.data).isVisible
    );
  }

  addNewAnnotation = evt => {
    const { currentPoints, element } = evt.detail,
      viewport = cornerstone.getEnabledElement(element)?.viewport,
      worldPos = currentPoints.world as Point3;
    if (!viewport || is3D(viewport) || !worldPos?.every(Number.isFinite)) return;
    const data = viewport.getImageData?.();
    if (data?.imageData && data.dimensions) {
      const index = data.imageData.worldToIndex(worldPos);
      if (index.some((v, i) => v < 0 || v > data.dimensions[i] - 1)) return;
    }
    const implant = this.configuration.implant || {},
      length = implant.dimensions?.length || 10;
    const camera = viewport.getCamera(),
      normal = camera.viewPlaneNormal || [0, 0, 1];
    const item = {
      annotationUID: cornerstone.utilities.uuidv4(),
      highlighted: true,
      isVisible: true,
      isLocked: false,
      invalidated: true,
      metadata: {
        toolName: DentalImplantTool.toolName,
        viewPlaneNormal: [...normal] as Point3,
        viewUp: camera.viewUp ? ([...camera.viewUp] as Point3) : undefined,
        FrameOfReferenceUID: viewport.getFrameOfReferenceUID(),
        dentalVolumeId: volumeId(viewport),
        referencedImageId: viewport.getCurrentImageId?.() || '',
      },
      data: {
        label: '',
        visible: true,
        isLocked: false,
        cachedStats: {},
        implant,
        handles: {
          points: implantEndpoints(worldPos, length),
          activeHandleIndex: null,
          textBox: {
            hasMoved: false,
            worldPosition: [0, 0, 0] as Point3,
            worldBoundingBox: {
              topLeft: [0, 0, 0] as Point3,
              topRight: [0, 0, 0] as Point3,
              bottomLeft: [0, 0, 0] as Point3,
              bottomRight: [0, 0, 0] as Point3,
            },
          },
        },
      },
    };
    annotation.state.addAnnotation(item, element);
    this.createMemo(element, item, { newAnnotation: true });
    this.doneEditMemo();
    annotation.selection?.setAnnotationSelected(item.annotationUID);
    setTimeout(() => {
      this.configuration.onPlaced?.();
      window.dispatchEvent(new Event('orbital:implant-placed'));
      if (
        volumeId(cornerstone.getEnabledElement(element)?.viewport) !== item.metadata.dentalVolumeId
      )
        return;
      this.renderLinkedViews();
      this.openEditor(element, item);
      cornerstone.getEnabledElements().forEach(({ viewport: vp }) => {
        if (is3D(vp)) vp.render();
      });
    }, 0);
    return item;
  };
  getHandleNearImagePoint(element, item, canvas, proximity = 6) {
    const viewport = cornerstone.getEnabledElement(element)?.viewport;
    if (
      !viewport ||
      is3D(viewport) ||
      !annotation.selection?.isAnnotationSelected(item.annotationUID) ||
      !this._checkVisibility(viewport, item.data.handles.points, item.data).isVisible
    )
      return null;
    const [a, b] = item.data.handles.points.map(p => viewport.worldToCanvas(p));
    return distance2(a, b) >= 12 && distance2(b, canvas) <= Math.max(8, proximity)
      ? item.data.handles.points[1]
      : null;
  }
  handleSelectedCallback(evt, item, handle) {
    if (handle !== item.data.handles.points[1] || !evt.detail.currentPoints?.world) return;
    this.toolSelectedCallback(evt, item);
    if (this.gesture) this.gesture.mode = 'rotate';
  }
  isPointNearToolData(element, item, canvas, proximity = 6) {
    const viewport = cornerstone.getEnabledElement(element)?.viewport;
    if (!viewport) return false;
    if (this.getHandleNearImagePoint(element, item, canvas, proximity)) return true;
    const vis = this._checkVisibility(viewport, item.data.handles.points, item.data);
    if (!vis.isVisible) return false;
    const contour = vis.contour || item.data.handles.points.map(p => viewport.worldToCanvas(p));
    let inside = false;
    for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
      const a = contour[i],
        b = contour[j],
        dx = b[0] - a[0],
        dy = b[1] - a[1];
      const t = Math.max(
        0,
        Math.min(1, ((canvas[0] - a[0]) * dx + (canvas[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))
      );
      if (distance2(canvas, [a[0] + t * dx, a[1] + t * dy]) <= proximity) return true;
      if (
        a[1] > canvas[1] !== b[1] > canvas[1] &&
        canvas[0] < ((b[0] - a[0]) * (canvas[1] - a[1])) / (b[1] - a[1]) + a[0]
      )
        inside = !inside;
    }
    return inside;
  }
  _checkVisibility(viewport, points, data) {
    const empty = {
      isVisible: false,
      isEndView: false,
      showStartPoint: false,
      drawWidthPx: 0,
      distToPlane: 0,
      contour: null,
    };
    if (is3D(viewport)) return { ...empty, isVisible: true };
    const camera = viewport.getCamera();
    if (!camera.viewPlaneNormal || !camera.focalPoint) return empty;
    const section = implantPlaneSection(
      points[0],
      points[1],
      (data.implant?.dimensions?.diameter || 4) / 2,
      camera.focalPoint,
      camera.viewPlaneNormal
    );
    if (!section.length) return empty;
    const contour = section.map(p => viewport.worldToCanvas(p)),
      axis = points[1].map((v, i) => v - points[0][i]);
    const dot = Math.abs(
      axis.reduce((s, v, i) => s + v * camera.viewPlaneNormal[i], 0) /
        (Math.hypot(...axis) * Math.hypot(...camera.viewPlaneNormal))
    );
    return {
      ...empty,
      isVisible: true,
      isEndView: dot > 0.8,
      showStartPoint: true,
      contour,
      drawWidthPx: Math.max(...contour.map(p => p[0])) - Math.min(...contour.map(p => p[0])),
    };
  }

  _update3DActor(viewport, uid, start, end, diameter, color) {
    const renderer = viewport.getRenderer?.(),
      matrix = implantMatrix(start, end, diameter);
    if (!renderer || !matrix) return;
    const key = `${uid}-${viewport.id}`,
      signature = JSON.stringify([start, end, diameter, color]);
    if (this.pipelineMap.get(key)?.signature === signature) return;
    let actor = this.actorMap.get(key);
    if (!actor) {
      const source = vtkCylinderSource.newInstance({
        resolution: 64,
        height: 1,
        radius: 0.5,
        capping: true,
      });
      const mapper = vtkMapper.newInstance();
      mapper.setInputConnection(source.getOutputPort());
      actor = vtkActor.newInstance();
      actor.setMapper(mapper);
      actor.setPickable(false);
      renderer.addActor(actor);
      this.actorMap.set(key, actor);
      this.pipelineMap.set(key, { source, mapper, signature: '', viewport });
    }
    actor
      .getProperty()
      .setColor(...[1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255));
    actor.getProperty().setAmbient(0.3);
    actor.getProperty().setDiffuse(0.8);
    actor.setScale(1, 1, 1);
    actor.setPosition(0, 0, 0);
    actor.setOrientation(0, 0, 0);
    actor.setUserMatrix(matrix);
    this.pipelineMap.get(key).signature = signature;
    viewport.render();
  }
  renderAnnotation = (enabledElement, svg) => {
    const { viewport } = enabledElement;
    const items: any[] = (
      annotation.state.getAnnotations(this.getToolName(), viewport.element) || []
    ).filter(
      (item: any) =>
        (!item.metadata.dentalVolumeId || item.metadata.dentalVolumeId === volumeId(viewport)) &&
        annotation.visibility.isAnnotationVisible(item.annotationUID) &&
        item.data.visible !== false
    );
    const live = new Set(items.map(item => `${item.annotationUID}-${viewport.id}`));
    for (const [key, pipeline] of this.pipelineMap)
      if (pipeline.viewport === viewport && !live.has(key)) {
        viewport.getRenderer().removeActor(this.actorMap.get(key));
        this.actorMap.get(key).delete();
        pipeline.mapper.delete();
        pipeline.source.delete();
        this.actorMap.delete(key);
        this.pipelineMap.delete(key);
        viewport.render();
      }
    let rendered = false;
    for (const item of items) {
      const { annotationUID: uid, data } = item,
        [start, end] = data.handles.points,
        diameter = data.implant?.dimensions?.diameter || 4,
        color = data.implant?.color || '#FFFF00';
      if (is3D(viewport)) {
        this._update3DActor(viewport, uid, start, end, diameter, color);
        rendered = true;
        continue;
      }
      const vis = this._checkVisibility(viewport, [start, end], data);
      if (!vis.isVisible) continue;
      drawing.drawPolyline(svg, uid, 'implant-section', vis.contour, {
        color,
        lineWidth: 2,
        fillColor: color,
        fillOpacity: 0.2,
        closePath: true,
      });
      if (
        annotation.selection?.isAnnotationSelected(uid) &&
        !annotation.locking.isAnnotationLocked(uid)
      ) {
        const a = viewport.worldToCanvas(start),
          b = viewport.worldToCanvas(end);
        drawing.drawCircle(svg, uid, 'implant-platform', a, 3, { color: '#67e8f9', lineWidth: 1 });
        if (distance2(a, b) >= 12) {
          drawing.drawLine(svg, uid, 'implant-projected-axis', a, b, {
            color: '#67e8f9',
            lineWidth: 1,
            lineDash: [4, 4],
          });
          drawing.drawCircle(svg, uid, 'implant-rotate', b, 6, {
            color: '#67e8f9',
            fillColor: '#0e283a',
            fillOpacity: 1,
            lineWidth: 2,
          });
        }
      }
      rendered = true;
    }
    return rendered;
  };
}
export default DentalImplantTool;
