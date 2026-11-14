import DentalCrosshairsTool from './DentalCrosshairsTool';
import { intersectMprPlanes } from '../components/ManualPanorama/panoramaCrosshair';
import { getEnabledElement, getRenderingEngine } from '@cornerstonejs/core';
import { getToolGroup } from '@cornerstonejs/tools/store/ToolGroupManager';
import { getAnnotations } from '@cornerstonejs/tools/stateManagement/annotation/annotationState';
import { setAxesVisible } from '@ohif/core/src/constants/orbitalAxes';

// Exercise the installed CrosshairsTool camera handler and setToolCenter, not a
// duplicate implementation. Only its unrelated UI/annotation infrastructure is stubbed.
jest.mock('@cornerstonejs/tools', () => ({
  CrosshairsTool: jest.requireActual('@cornerstonejs/tools/tools/CrosshairsTool').default,
  state: { isInteractingWithTool: false },
  utilities: { triggerAnnotationRender: jest.fn() },
}));
jest.mock('@cornerstonejs/tools/tools/base', () => ({
  AnnotationTool: class {
    configuration;
    toolGroupId;
    constructor(props, defaults) {
      this.configuration = { ...defaults.configuration, ...props.configuration };
      this.toolGroupId = props.toolGroupId;
    }
    getToolName() {
      return this.constructor['toolName'];
    }
  },
}));
jest.mock('@cornerstonejs/core', () => ({
  getEnabledElement: jest.fn(),
  getRenderingEngine: jest.fn(),
  getEnabledElementByIds: jest.fn(),
  eventTarget: new EventTarget(),
  triggerEvent: jest.fn(),
  CONSTANTS: { RENDERING_DEFAULTS: { MINIMUM_SLAB_THICKNESS: 0.05 } },
  Enums: { BlendModes: { MAXIMUM_INTENSITY_BLEND: 1, COMPOSITE: 0 } },
  utilities: {
    isEqual: (a, b, tolerance = 1e-3) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance),
  },
}));
jest.mock('@cornerstonejs/tools/store/ToolGroupManager', () => ({
  getToolGroup: jest.fn(),
  getToolGroupForViewport: jest.fn(),
}));
jest.mock('@cornerstonejs/tools/stateManagement/annotation/annotationState', () => ({
  getAnnotations: jest.fn(),
  addAnnotation: jest.fn(),
  removeAnnotation: jest.fn(),
}));
jest.mock('@cornerstonejs/tools/drawingSvg', () => ({}));
jest.mock('@cornerstonejs/tools/store/state', () => ({ state: { isInteractingWithTool: false } }));
jest.mock('@cornerstonejs/tools/utilities/viewportFilters', () => ({
  getViewportIdsWithToolToRender: () => [],
}));
jest.mock('@cornerstonejs/tools/cursors/elementCursor', () => ({}));
jest.mock('@cornerstonejs/tools/stateManagement/annotation/annotationLocking', () => ({
  isAnnotationLocked: () => false,
}));
jest.mock('@cornerstonejs/tools/utilities/triggerAnnotationRenderForViewportIds', () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe('Dental MPR camera and crosshair synchronization with native Cornerstone', () => {
  let tool, viewports, annotations;
  const clone = camera =>
    Object.fromEntries(
      Object.entries(camera).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value])
    );
  const aligned = expected => {
    const planes = Object.values(viewports).map((viewport: any) => viewport.getCamera());
    const intersection = intersectMprPlanes(planes);
    intersection.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 6));
    tool.toolCenter.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 6));
    planes.forEach(camera => {
      const offset = camera.viewPlaneNormal.reduce(
        (sum, n, i) => sum + n * (expected[i] - camera.focalPoint[i]),
        0
      );
      expect(offset).toBeCloseTo(0, 6);
    });
  };
  beforeEach(() => {
    setAxesVisible(true);
    jest.clearAllMocks();
    tool = new DentalCrosshairsTool({ toolGroupId: 'mpr' });
    annotations = [];
    viewports = {};
    const definitions = [
      ['mpr-coronal', [0, 20, 0], [0, 1, 0]],
      ['mpr-sagittal', [10, 0, 0], [1, 0, 0]],
      ['mpr-axial', [0, 0, 30], [0, 0, 1]],
    ];
    for (const [id, focalPoint, normal] of definitions as any[]) {
      const element = document.createElement('div');
      let camera = {
        focalPoint,
        viewPlaneNormal: normal,
        position: focalPoint.map((v, i) => v + normal[i] * 100),
        parallelScale: 80,
      };
      const viewport = {
        id,
        element,
        getCamera: () => clone(camera),
        setCamera: jest.fn(next => {
          camera = { ...camera, ...clone(next) };
          tool.onCameraModified({ detail: { element } });
        }),
        render: jest.fn(),
        getSlabThickness: jest.fn(() => 0.05),
        setSlabThickness: jest.fn(value => viewport.getSlabThickness.mockReturnValue(value)),
        resetSlabThickness: jest.fn(() => viewport.getSlabThickness.mockReturnValue(0.05)),
        setBlendMode: jest.fn(),
      };
      viewports[id] = viewport;
      annotations.push({
        data: { viewportId: id },
        metadata: { cameraPosition: [...camera.position], cameraFocalPoint: [...focalPoint] },
      });
    }
    const engine = { id: 'engine', getViewport: id => viewports[id] };
    (getRenderingEngine as jest.Mock).mockReturnValue(engine);
    (getEnabledElement as jest.Mock).mockImplementation(element => {
      const viewport: any = Object.values(viewports).find((v: any) => v.element === element);
      return { viewport, viewportId: viewport.id, renderingEngine: engine };
    });
    (getAnnotations as jest.Mock).mockImplementation(() => annotations);
    (getToolGroup as jest.Mock).mockReturnValue({
      viewportsInfo: Object.keys(viewports).map(viewportId => ({
        renderingEngineId: 'engine',
        viewportId,
      })),
    });
    tool.toolCenter = [10, 20, 30];
  });
  afterEach(() => setAxesVisible(true));
  it('changes only the selected slab, retains cameras and restores native composite rendering on reset', () => {
    const target = viewports['mpr-coronal'];
    const cameras = Object.values(viewports).map((viewport: any) => viewport.getCamera());
    expect(tool.changeSlabThickness(target, 1)).toBe(true);
    expect(target.getSlabThickness()).toBe(1);
    expect(target.setBlendMode).toHaveBeenLastCalledWith(1, undefined, false);
    expect(viewports['mpr-axial'].getSlabThickness()).toBe(0.05);
    tool.changeSlabThickness(target, 1);
    expect(target.getSlabThickness()).toBe(2);
    tool.changeSlabThickness(target, -1);
    expect(target.getSlabThickness()).toBe(1);
    tool.changeSlabThickness(target, 'reset');
    expect(target.getSlabThickness()).toBe(0.05);
    expect(target.setBlendMode).toHaveBeenLastCalledWith(0, undefined, false);
    expect(target.resetSlabThickness).toHaveBeenCalledTimes(1);
    expect(Object.values(viewports).map((viewport: any) => viewport.getCamera())).toEqual(cameras);
    expect(tool.toolCenter).toEqual([10, 20, 30]);
  });
  it('bounds slab wheel changes and respects hidden axes and locked planes', () => {
    const target = viewports['mpr-coronal'];
    tool.changeSlabThickness(target, -1);
    expect(target.setSlabThickness).not.toHaveBeenCalled();
    target.getSlabThickness.mockReturnValue(99.5);
    tool.changeSlabThickness(target, 1);
    expect(target.getSlabThickness()).toBe(100);
    tool.changeSlabThickness(target, 1);
    expect(target.setSlabThickness).toHaveBeenCalledTimes(1);
    setAxesVisible(false);
    expect(tool.changeSlabThickness(target, 'reset')).toBe(false);
    setAxesVisible(true);
    tool._getReferenceLineSlabThicknessControlsOn = () => false;
    expect(tool.changeSlabThickness(target, 'reset')).toBe(false);
    expect(target.getSlabThickness()).toBe(100);
  });
  it('uses the elongated visible grip geometry for slab and rotation hit tests', () => {
    const viewport = viewports['mpr-axial'];
    viewport.worldToCanvas = point => point.slice(0, 2);
    tool.configuration.explainHandles = true;
    const current = annotations[2];
    current.data.handles = {
      slabThicknessPoints: [[[50, 40, 30], viewports['mpr-coronal'], [0, 40], [100, 40]]],
      rotationPoints: [[[80, 40, 30], viewports['mpr-coronal'], [0, 40], [100, 40]]],
    };
    const hit = tool.getSlabHandleAtPoint(viewport.element, [68, 40]);
    expect(hit.target.id).toBe('mpr-coronal');
    expect(tool.getHandleNearImagePoint(viewport.element, current, [68, 40], 6)).toEqual([50, 40, 30]);
    expect(current.data.handles.activeOperation).toBe(3);
    expect(tool.getSlabHandleAtPoint(viewport.element, [50, 49])).toBeUndefined();
    expect(tool.getSlabWheelTarget(viewport.element, [20, 43]).id).toBe('mpr-coronal');
    expect(tool.getSlabWheelTarget(viewport.element, [50, 59])).toBeUndefined();
    expect(tool.getSlabWheelTarget(viewport.element, [80, 40])).toBeUndefined();
    tool.getHandleNearImagePoint(viewport.element, current, [90, 40], 6);
    expect(current.data.handles.activeOperation).toBe(2);
    tool.mode = 'Passive';
    expect(tool.getHandleNearImagePoint(viewport.element, current, [50, 40], 6)).toBeNull();
    expect(tool.isPointNearTool(viewport.element, current, [50, 40], 6)).toBe(false);
    tool.mode = 'Active';
    setAxesVisible(false);
    expect(tool.getSlabHandleAtPoint(viewport.element, [50, 40])).toBeUndefined();
  });
  it('hides lines and their hit targets while retaining the physical point and camera synchronization', () => {
    setAxesVisible(false);
    expect(tool.renderAnnotation(null, null)).toBe(false);
    expect(tool.getHandleNearImagePoint(null, null, null, 6)).toBe(null);
    expect(tool.isPointNearTool(null, null, null, 6)).toBe(false);
    expect(tool.toolCenter).toEqual([10, 20, 30]);
    tool.setToolCenter([25, 35, 45]);
    aligned([25, 35, 45]);
    setAxesVisible(true);
    aligned([25, 35, 45]);
  });

  it('does not turn axial recentering plus a slice change into a false sagittal/coronal position', () => {
    viewports['mpr-axial'].setCamera({ focalPoint: [40, 50, 40], position: [40, 50, 140] });
    aligned([10, 20, 40]);
    expect(viewports['mpr-axial'].getCamera().focalPoint).toEqual([40, 50, 40]);
    // A subsequent native axial click/drag must move actual sagittal/coronal
    // slices to the selected point, without retaining the editor's pan offset.
    tool._applyDeltaShiftToSelectedViewportCameras(
      getRenderingEngine('engine'),
      annotations.slice(0, 2),
      [15, -5, 0]
    );
    aligned([25, 15, 40]);
  });
  it('keeps native slice scrolling, in-plane panning and explicit center changes consistent', () => {
    viewports['mpr-axial'].setCamera({ focalPoint: [0, 0, 32], position: [0, 0, 132] });
    aligned([10, 20, 32]);
    viewports['mpr-axial'].setCamera({ focalPoint: [50, 60, 32], position: [50, 60, 132] });
    aligned([10, 20, 32]);
    tool.setToolCenter([25, 35, 45]);
    aligned([25, 35, 45]);
  });
  it('retains the native independent plane shifts used when clicking or dragging the axial crosshair', () => {
    const engine = getRenderingEngine('engine');
    tool._applyDeltaShiftToSelectedViewportCameras(engine, annotations.slice(0, 2), [15, -5, 0]);
    aligned([25, 15, 30]);
  });
  it('preserves the common physical point for a rotated set of orthogonal MPR planes', () => {
    const s = Math.SQRT1_2;
    const normals = [
      [0, s, -s],
      [1, 0, 0],
      [0, s, s],
    ];
    Object.values(viewports).forEach((viewport: any, i) => {
      const point = [10, 20, 30];
      viewport.setCamera({
        focalPoint: point,
        position: point.map((v, axis) => v + normals[i][axis] * 100),
        viewPlaneNormal: normals[i],
      });
    });
    tool.setToolCenter([10, 20, 30]);
    const source = viewports['mpr-axial'];
    const camera = source.getCamera();
    const delta = [5, 6, 8];
    source.setCamera({
      focalPoint: camera.focalPoint.map((v, i) => v + delta[i]),
      position: camera.position.map((v, i) => v + delta[i]),
    });
    aligned([10, 27, 37]);
    expect(source.getCamera().parallelScale).toBe(80);
    expect(source.getCamera().viewPlaneNormal).toEqual(normals[2]);
  });
  it('leaves native camera rotation and zoom alone', () => {
    const setter = jest.spyOn(tool, 'setToolCenter');
    const source = viewports['mpr-axial'];
    source.setCamera({ parallelScale: 40 });
    aligned([10, 20, 30]);
    // Rotate the axial camera around the existing physical crosshair.
    source.setCamera({
      focalPoint: [10, 0, 40],
      position: [110, 0, 40],
      viewPlaneNormal: [1, 0, 0],
    });
    expect(tool.toolCenter).toEqual([10, 20, 30]);
    expect(setter).not.toHaveBeenCalled();
    expect(source.getCamera().parallelScale).toBe(40);
  });
  it('respects reference planes configured as uncontrollable', () => {
    const setter = jest.spyOn(tool, 'setToolCenter');
    tool._getReferenceLineControllable = () => false;
    viewports['mpr-axial'].setCamera({ focalPoint: [40, 50, 40], position: [40, 50, 140] });
    expect(tool.toolCenter).toEqual([10, 20, 30]);
    expect(setter).not.toHaveBeenCalled();
  });
  it('disables automatic image panning even if a mode enables it', () => {
    const instance = new DentalCrosshairsTool({ toolGroupId: 'mpr', configuration: { autoPan: { enabled: true, panSize: 5 } } });
    expect(instance.configuration.autoPan.enabled).toBe(false);
  });
  it('stops a crosshair drag at the volume edge without changing its direction', () => {
    Object.values(viewports).forEach((viewport: any) => {
      viewport.getImageData = () => ({ dimensions: [100, 100, 100], imageData: { worldToIndex: p => [...p] } });
    });
    const before = viewports['mpr-axial'].getCamera();
    tool._applyDeltaShiftToSelectedViewportCameras(getRenderingEngine('engine'), annotations.slice(0, 2), [200, 100, 0]);
    aligned([99, 64.5, 30]);
    expect(viewports['mpr-axial'].getCamera()).toEqual(before);
    tool._applyDeltaShiftToSelectedViewportCameras(getRenderingEngine('engine'), annotations.slice(0, 2), [-20, -10, 0]);
    aligned([79, 54.5, 30]);
  });
  it('clips an oriented 0.2 mm volume and keeps repeated edge drags bounded despite matrix round-off', () => {
    Object.values(viewports).forEach((viewport: any) => {
      viewport.getImageData = () => ({ dimensions: [100, 100, 100], imageData: {
        worldToIndex: p => [150 - p[1] * 5, p[0] * 5 + 1e-10, p[2] * 5 - 100],
      } });
    });
    const move = delta => tool._applyDeltaShiftToSelectedViewportCameras(getRenderingEngine('engine'), annotations.slice(0, 2), delta);
    move([200, 100, 0]);
    aligned([19.8, 24.9, 30]);
    move([200, 100, 0]);
    aligned([19.8, 24.9, 30]);
    move([-2, -1, 0]);
    aligned([17.8, 23.9, 30]);
  });
});
