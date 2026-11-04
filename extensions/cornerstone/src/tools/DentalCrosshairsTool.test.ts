import DentalCrosshairsTool from './DentalCrosshairsTool';
import { intersectMprPlanes } from '../components/ManualPanorama/panoramaCrosshair';
import { getEnabledElement, getRenderingEngine } from '@cornerstonejs/core';
import { getToolGroup } from '@cornerstonejs/tools/store/ToolGroupManager';
import { getAnnotations } from '@cornerstonejs/tools/stateManagement/annotation/annotationState';

// Exercise the installed CrosshairsTool camera handler and setToolCenter, not a
// duplicate implementation. Only its unrelated UI/annotation infrastructure is stubbed.
jest.mock('@cornerstonejs/tools', () => ({
  CrosshairsTool: jest.requireActual('@cornerstonejs/tools/tools/CrosshairsTool').default,
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
  CONSTANTS: { RENDERING_DEFAULTS: {} },
  Enums: { BlendModes: { MAXIMUM_INTENSITY_BLEND: 1 } },
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
});
