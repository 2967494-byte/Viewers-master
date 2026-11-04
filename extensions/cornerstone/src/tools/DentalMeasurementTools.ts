import {
  AnnotationTool,
  annotation,
  drawing,
  utilities,
  Enums as ToolEnums,
} from '@cornerstonejs/tools';
import {
  Enums,
  getEnabledElement,
  getEnabledElements,
  utilities as coreUtilities,
} from '@cornerstonejs/core';
import vtkCellPicker from '@kitware/vtk.js/Rendering/Core/CellPicker';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkTubeFilter from '@kitware/vtk.js/Filters/General/TubeFilter';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import {
  angle3D,
  dentalPath,
  distance3D,
  pathInSlice,
  pathLength,
  type Point3,
} from './dentalGeometry';

type Draft = { annotation: any; element: HTMLDivElement; preview?: Point3; cleanup: () => void };
const drafts = new Map<string, Draft>();

export function cancelDentalDraft(uid: string) {
  for (const [name, draft] of drafts) {
    if (draft.annotation.annotationUID !== uid) continue;
    draft.cleanup();
    drafts.delete(name);
    annotation.state.removeAnnotation(uid);
    return true;
  }
  return false;
}

export function renderDentalAnnotations() {
  getEnabledElements().forEach(({ viewport }) => {
    if (viewport?.element) utilities.triggerAnnotationRender(viewport.element);
  });
}

function sameVolume(item, viewport) {
  return (
    item.metadata.FrameOfReferenceUID === viewport.getFrameOfReferenceUID() &&
    item.metadata.dentalVolumeId === viewport.getVolumeId?.()
  );
}

/** Pick a visible volume surface, never the arbitrary focal plane behind a 3D canvas. */
export function pickDentalPoint(viewport, canvas: [number, number], world: Point3): Point3 | null {
  if (viewport.type !== Enums.ViewportType.VOLUME_3D) return [...world];
  const picker = vtkCellPicker.newInstance({ opacityThreshold: 0.2 });
  try {
    const volumes = viewport.getActors().filter(entry => entry.actor?.isA('vtkVolume'));
    if (!volumes.length) return null;
    picker.setPickFromList(true);
    picker.setPickList(volumes.map(entry => entry.actor));
    const display = viewport.getVtkDisplayCoords(canvas);
    picker.pick(display, viewport.getRenderer());
    const hit = picker.getPickedPositions()[0];
    return hit?.every(Number.isFinite) ? ([...hit] as Point3) : null;
  } finally {
    picker.delete();
  }
}

/** Click-based world-space measurements shared between MPR panes and the volume renderer. */
class DentalMeasurementTool extends AnnotationTool {
  static toolName = 'DentalMeasurement';
  // These tools use click callbacks, not the default drag-to-create dispatcher.
  addNewAnnotation: any = undefined;
  private tubes = new Map<string, { viewport: any; signature: string; objects: any[] }>();
  private stopEditing?: () => void;

  constructor(toolProps = {}) {
    super(toolProps, {
      supportedInteractionTypes: ['Mouse', 'Touch'],
      configuration: { kind: 'length', curved: false, radius: 1, planar: false },
    });
    this.mouseMoveCallback = evt => {
      const draft = drafts.get(this.getToolName());
      const viewport = getEnabledElement(evt.detail.element)?.viewport as any;
      if (!draft || !viewport || !sameVolume(draft.annotation, viewport)) return false;
      // Avoid a costly volume pick for every pointer movement.
      draft.preview =
        viewport.type === Enums.ViewportType.VOLUME_3D
          ? undefined
          : ([...evt.detail.currentPoints.world] as Point3);
      if (draft.preview && this.configuration.planar)
        draft.preview = this.inMeasurementPlane(draft.annotation, draft.preview);
      renderDentalAnnotations();
      return true;
    };
  }

  private inMeasurementPlane(item, point: Point3): Point3 {
    const normal = item.metadata.viewPlaneNormal;
    const origin = item.data.handles.points[0];
    const offset = point.reduce((sum, value, i) => sum + (value - origin[i]) * normal[i], 0);
    return point.map((value, i) => value - offset * normal[i]) as Point3;
  }

  private finish = () => {
    const name = this.getToolName(),
      draft = drafts.get(name);
    if (!draft) return;
    const minimum = this.configuration.kind === 'angle' ? 3 : 2;
    if (draft.annotation.data.handles.points.length < minimum) return;
    draft.annotation.data.dentalComplete = true;
    draft.annotation.invalidated = true;
    draft.cleanup();
    drafts.delete(name);
    annotation.state.triggerAnnotationCompleted(draft.annotation);
    renderDentalAnnotations();
  };

  cancel() {
    const name = this.getToolName(),
      draft = drafts.get(name);
    if (!draft) return;
    draft.cleanup();
    drafts.delete(name);
    annotation.state.removeAnnotation(draft.annotation.annotationUID);
    renderDentalAnnotations();
    return draft.annotation.annotationUID;
  }

  onSetToolPassive() {
    this.cancel();
    this.stopEditing?.();
  }
  onSetToolDisabled() {
    this.onSetToolPassive();
    for (const id of this.tubes.keys()) this.removeTube(id);
  }

  mouseClickCallback = evt => {
    if (evt.detail.event?.button > 0) return;
    const { element, currentPoints } = evt.detail;
    const viewport = getEnabledElement(element)?.viewport as any;
    if (!viewport?.getVolumeId?.()) return;
    let point = pickDentalPoint(viewport, currentPoints.canvas, currentPoints.world);
    if (!point) return;
    const name = this.getToolName();
    let draft = drafts.get(name);
    if (draft && !sameVolume(draft.annotation, viewport)) {
      this.cancel();
      draft = undefined;
    }
    if (
      draft &&
      this.configuration.planar &&
      !this.filterInteractableAnnotationsForElement(element, [draft.annotation]).length
    )
      return;
    if (!draft) {
      const camera = viewport.getCamera();
      const item = {
        annotationUID: coreUtilities.uuidv4(),
        highlighted: true,
        invalidated: true,
        isVisible: true,
        isLocked: false,
        metadata: {
          toolName: name,
          FrameOfReferenceUID: viewport.getFrameOfReferenceUID(),
          dentalVolumeId: viewport.getVolumeId(),
          viewPlaneNormal: [...camera.viewPlaneNormal],
          viewUp: [...camera.viewUp],
        },
        data: {
          handles: { points: [point], activeHandleIndex: null },
          cachedStats: {},
          label: '',
          dentalComplete: false,
          radius: this.configuration.radius,
        },
      };
      annotation.state.addAnnotation(item as any, element);
      annotation.selection.setAnnotationSelected(item.annotationUID);
      const keydown = (event: KeyboardEvent) => {
        if (
          (event.target as HTMLElement)?.closest?.('input,select,textarea,[contenteditable=true]')
        )
          return;
        if (event.key === 'Enter') {
          event.preventDefault();
          this.finish();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          this.cancel();
        }
        if (event.key === 'Backspace' || event.key === 'Delete') {
          event.preventDefault();
          const current = drafts.get(name);
          current?.annotation.data.handles.points.pop();
          if (!current?.annotation.data.handles.points.length) this.cancel();
          renderDentalAnnotations();
        }
      };
      window.addEventListener('keydown', keydown);
      draft = {
        annotation: item,
        element,
        cleanup: () => window.removeEventListener('keydown', keydown),
      };
      drafts.set(name, draft);
    } else {
      if (this.configuration.planar) point = this.inMeasurementPlane(draft.annotation, point);
      const points = draft.annotation.data.handles.points;
      if (distance3D(points[points.length - 1], point) > 0.1) points.push(point);
      draft.preview = undefined;
      draft.annotation.invalidated = true;
      const count =
        this.configuration.kind === 'length'
          ? 2
          : this.configuration.kind === 'angle'
            ? 3
            : Infinity;
      if (points.length >= count) this.finish();
    }
    evt.preventDefault();
    renderDentalAnnotations();
  };
  touchTapCallback = evt => this.mouseClickCallback(evt);
  doubleClickCallback = () => this.finish();

  // Active tools edit only their own handles. Passive annotations cannot steal navigation clicks.
  getHandleNearImagePoint() {
    return undefined;
  }
  isPointNearTool() {
    return false;
  }
  handleSelectedCallback() {}
  toolSelectedCallback() {}
  filterInteractableAnnotationsForElement(element, items) {
    const viewport = getEnabledElement(element)?.viewport;
    return viewport
      ? items.filter(item => {
          if (!sameVolume(item, viewport)) return false;
          if (!this.configuration.planar || viewport.type === Enums.ViewportType.VOLUME_3D)
            return true;
          const normal = viewport.getCamera().viewPlaneNormal;
          return (
            Math.abs(
              item.metadata.viewPlaneNormal.reduce((sum, value, i) => sum + value * normal[i], 0)
            ) > 0.999
          );
        })
      : [];
  }
  preMouseDownCallback = evt => {
    if (evt.detail.event?.buttons !== 1 || drafts.has(this.getToolName())) return false;
    const { element, currentPoints } = evt.detail;
    const viewport = getEnabledElement(element)?.viewport as any;
    if (!viewport) return false;
    const items = this.filterInteractableAnnotationsForElement(
      element,
      annotation.state.getAnnotations(this.getToolName(), element) || []
    );
    for (const item of items) {
      if (
        !annotation.visibility.isAnnotationVisible(item.annotationUID) ||
        annotation.locking.isAnnotationLocked(item.annotationUID)
      )
        continue;
      const index = item.data.handles.points.findIndex(point => {
        const canvas = viewport.worldToCanvas(point);
        return (
          Math.hypot(canvas[0] - currentPoints.canvas[0], canvas[1] - currentPoints.canvas[1]) <= 10
        );
      });
      if (index < 0) continue;
      annotation.selection.setAnnotationSelected(item.annotationUID);
      this.createMemo(element, item);
      const drag = event => {
        let point = pickDentalPoint(
          viewport,
          event.detail.currentPoints.canvas,
          event.detail.currentPoints.world
        );
        if (!point) return;
        if (this.configuration.planar) point = this.inMeasurementPlane(item, point);
        item.data.handles.points[index] = point;
        item.invalidated = true;
        annotation.state.triggerAnnotationModified(item, element);
        renderDentalAnnotations();
      };
      const end = () => {
        element.removeEventListener(ToolEnums.Events.MOUSE_DRAG, drag);
        element.removeEventListener(ToolEnums.Events.MOUSE_UP, end);
        window.removeEventListener('blur', end);
        this.stopEditing = undefined;
        this.doneEditMemo();
      };
      this.stopEditing?.();
      this.stopEditing = end;
      element.addEventListener(ToolEnums.Events.MOUSE_DRAG, drag);
      element.addEventListener(ToolEnums.Events.MOUSE_UP, end);
      window.addEventListener('blur', end);
      evt.preventDefault();
      return true;
    }
    return false;
  };

  private removeTube(id: string) {
    const entry = this.tubes.get(id);
    if (!entry) return;
    try {
      entry.viewport.removeActors([id]);
      entry.viewport.render();
    } catch {
      /* Viewport may already be disposed. */
    }
    entry.objects.forEach(object => object.delete());
    this.tubes.delete(id);
  }

  private updateCanalActor(viewport, item, path: Point3[]) {
    const id = `dental-canal-${item.annotationUID}-${viewport.id}`;
    const signature = JSON.stringify([path, item.data.radius]);
    if (this.tubes.get(id)?.signature === signature) return;
    this.removeTube(id);
    if (path.length < 2) return;
    const poly = vtkPolyData.newInstance();
    poly.getPoints().setData(Float32Array.from(path.flat()), 3);
    poly.getLines().setData(Uint32Array.from([path.length, ...path.map((_, i) => i)]));
    const tube = vtkTubeFilter.newInstance({
      radius: item.data.radius || 1,
      numberOfSides: 16,
      capping: true,
    });
    tube.setInputData(poly);
    const mapper = vtkMapper.newInstance();
    mapper.setInputConnection(tube.getOutputPort());
    mapper.setScalarVisibility(false);
    const actor = vtkActor.newInstance();
    actor.setMapper(mapper);
    actor.getProperty().setColor(1, 0.3, 0.25);
    actor.getProperty().setOpacity(0.85);
    actor.setPickable(false);
    viewport.addActor({ uid: id, actor });
    this.tubes.set(id, { viewport, signature, objects: [actor, mapper, tube, poly] });
    viewport.render();
  }

  renderAnnotation = (enabledElement, svgDrawingHelper) => {
    const { viewport } = enabledElement;
    const items = this.filterInteractableAnnotationsForElement(
      viewport.element,
      annotation.state.getAnnotations(this.getToolName(), viewport.element) || []
    ).filter(
      item =>
        sameVolume(item, viewport) && annotation.visibility.isAnnotationVisible(item.annotationUID)
    );
    const liveIds = new Set(items.map(item => `dental-canal-${item.annotationUID}-${viewport.id}`));
    for (const [id, entry] of this.tubes) {
      if (entry.viewport === viewport && !liveIds.has(id)) this.removeTube(id);
    }
    for (const item of items) {
      const uid = item.annotationUID;
      const draft = drafts.get(this.getToolName());
      const handles = item.data.handles.points as Point3[];
      const points =
        draft?.annotation === item && draft.preview ? [...handles, draft.preview] : handles;
      const path = dentalPath(points, this.configuration.curved);
      const canal = this.configuration.kind === 'canal';
      const radius = Number(item.data.radius) || 1;
      const color = canal ? '#ff6b61' : '#67e8f9';
      const is3D = viewport.type === Enums.ViewportType.VOLUME_3D;
      if (canal && is3D) this.updateCanalActor(viewport, item, path);
      const camera = viewport.getCamera();
      const planeOffset =
        handles[0]?.reduce(
          (sum, value, i) => sum + (value - camera.focalPoint[i]) * camera.viewPlaneNormal[i],
          0
        ) || 0;
      const offPlane = !!this.configuration.planar && !is3D && Math.abs(planeOffset) > 0.3;
      const paths =
        canal && !is3D
          ? pathInSlice(path, camera.focalPoint, camera.viewPlaneNormal, radius + 0.3)
          : [path];
      paths.forEach((segment, i) => {
        if (canal && is3D) return; // The VTK tube supplies proper depth occlusion in 3D.
        const canvas = segment.map(point => viewport.worldToCanvas(point));
        if (!canvas.length || !canvas.every(p => p.every(Number.isFinite))) return;
        const normal = camera.viewPlaneNormal,
          up = camera.viewUp;
        const right = [
          up[1] * normal[2] - up[2] * normal[1],
          up[2] * normal[0] - up[0] * normal[2],
          up[0] * normal[1] - up[1] * normal[0],
        ];
        const edge = viewport.worldToCanvas(segment[0].map((v, axis) => v + right[axis] * radius));
        const diameterPx = Math.hypot(edge[0] - canvas[0][0], edge[1] - canvas[0][1]) * 2;
        drawing.drawPolyline(svgDrawingHelper, uid, `path-${i}`, canvas, {
          color,
          lineWidth: canal ? Math.max(2, diameterPx) : 2,
          lineDash: !is3D && !canal && (!this.configuration.planar || offPlane) ? '5,3' : undefined,
        });
      });
      const visibleHandles =
        canal && !is3D
          ? handles.filter(
              point =>
                pathInSlice([point, point], camera.focalPoint, camera.viewPlaneNormal, radius + 0.3)
                  .length
            )
          : handles;
      drawing.drawHandles(
        svgDrawingHelper,
        uid,
        'points',
        visibleHandles.map(point => viewport.worldToCanvas(point)),
        { color, handleRadius: 5 }
      );
      const value =
        this.configuration.kind === 'angle'
          ? angle3D(handles)
          : pathLength(dentalPath(handles, this.configuration.curved));
      if (value !== null && handles.length > 1 && paths.some(segment => segment.length)) {
        const labelAt = viewport.worldToCanvas(paths[0][paths[0].length - 1]);
        const label =
          this.configuration.kind === 'angle'
            ? `${value.toFixed(1)}° · 3D`
            : `${value.toFixed(1)} мм${canal ? ' · канал' : this.configuration.planar ? ' · 2D' : ' · 3D'}`;
        item.data.cachedStats.dental = {
          value,
          unit: this.configuration.kind === 'angle' ? '°' : 'мм',
        };
        drawing.drawTextBox(
          svgDrawingHelper,
          uid,
          'value',
          offPlane
            ? [label, `Вне среза: ${planeOffset > 0 ? '+' : ''}${planeOffset.toFixed(1)} мм`]
            : [label],
          [labelAt[0] + 10, labelAt[1] - 20],
          { color, background: '#07121ddd', fontSize: '14px' }
        );
      }
    }
    return items.length > 0;
  };
}

export class DentalLength3DTool extends DentalMeasurementTool {
  static toolName = 'DentalLength3D';
}
export class DentalLength2DTool extends DentalMeasurementTool {
  static toolName = 'DentalLength2D';
  constructor(props = {}) {
    super(props);
    this.configuration.planar = true;
  }
}
export class DentalAngle3DTool extends DentalMeasurementTool {
  static toolName = 'DentalAngle3D';
  constructor(props = {}) {
    super(props);
    this.configuration.kind = 'angle';
  }
}
export class DentalTapeLineTool extends DentalMeasurementTool {
  static toolName = 'DentalTapeLine';
  constructor(props = {}) {
    super(props);
    this.configuration.kind = 'path';
  }
}
export class DentalTapeCurveTool extends DentalMeasurementTool {
  static toolName = 'DentalTapeCurve';
  constructor(props = {}) {
    super(props);
    this.configuration.kind = 'path';
    this.configuration.curved = true;
  }
}
export class DentalCanalTool extends DentalMeasurementTool {
  static toolName = 'DentalCanal';
  constructor(props = {}) {
    super(props);
    this.configuration.kind = 'canal';
    this.configuration.curved = true;
  }
}

export const dentalMeasurementTools = [
  DentalLength2DTool,
  DentalLength3DTool,
  DentalAngle3DTool,
  DentalTapeLineTool,
  DentalTapeCurveTool,
  DentalCanalTool,
];
