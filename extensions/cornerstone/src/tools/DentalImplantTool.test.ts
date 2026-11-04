import DentalImplantTool from './DentalImplantTool';
import { getEnabledElement } from '@cornerstonejs/core';
import { annotation } from '@cornerstonejs/tools';

jest.mock('@cornerstonejs/tools', () => ({
  LengthTool: class {
    configuration;
    constructor(props) {
      this.configuration = props.configuration || {};
      this.toolSelectedCallback = (evt, item) => {
        this.editData = { annotation: item, hasMoved: false };
      };
      this._dragCallback = evt => {
        this.editData.annotation.data.handles.points.forEach(point =>
          evt.detail.deltaPoints.world.forEach((v, i) => {
            point[i] += v;
          })
        );
        this.editData.hasMoved = true;
      };
      this._endCallback = () => {
        this.editData = null;
      };
    }
    createMemo() {}
    doneEditMemo() {}
  },
  drawing: {},
  annotation: {
    state: { addAnnotation: jest.fn(), removeAnnotation: jest.fn() },
    locking: { isAnnotationLocked: () => false },
    selection: { setAnnotationSelected: jest.fn(), isAnnotationSelected: jest.fn(() => true) },
  },
  utilities: {},
}));
jest.mock('@cornerstonejs/core', () => ({
  getEnabledElement: jest.fn(),
  getEnabledElements: () => [],
  utilities: { uuidv4: () => 'implant-id' },
  eventTarget: new EventTarget(),
  Enums: {
    ViewportType: { VOLUME_3D: 'volume3d' },
    Events: { VOLUME_VIEWPORT_NEW_VOLUME: 'new-volume', ELEMENT_DISABLED: 'disabled' },
  },
}));
jest.mock('@kitware/vtk.js/Rendering/Core/Actor', () => ({ __esModule: true, default: {} }));
jest.mock('@kitware/vtk.js/Rendering/Core/Mapper', () => ({ __esModule: true, default: {} }));
jest.mock('@kitware/vtk.js/Filters/Sources/CylinderSource', () => ({
  __esModule: true,
  default: {},
}));

describe('Implant placement on each MPR plane', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (getEnabledElement as jest.Mock).mockReturnValue({
      viewport: {
        type: 'orthographic',
        getCamera: () => ({ viewPlaneNormal: [0, 0, 1] }),
        getVolumeId: () => 'volume',
      },
    });
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });
  it('places the same patient-space axis and renders an axial end view versus coronal/sagittal side views', () => {
    const tool = new DentalImplantTool({
      configuration: { implant: { dimensions: { length: 10, diameter: 4 } } },
    });
    for (const [normal, viewUp, project, endView] of [
      [[0, 0, 1], [0, 1, 0], p => [p[0], p[1]], true],
      [[0, 1, 0], [0, 0, 1], p => [p[0], p[2]], false],
      [[1, 0, 0], [0, 0, 1], p => [p[1], p[2]], false],
    ] as any[]) {
      const viewport = {
        type: 'orthographic',
        getCamera: () => ({ viewPlaneNormal: normal, viewUp, focalPoint: [0, 0, 0] }),
        getFrameOfReferenceUID: () => 'frame',
        getVolumeId: () => 'volume',
        worldToCanvas: project,
      };
      (getEnabledElement as jest.Mock).mockReturnValue({ viewport });
      const item = tool.addNewAnnotation({
        detail: { element: document.createElement('div'), currentPoints: { world: [0, 0, 0] } },
      });
      expect(item.data.handles.points).toEqual([
        [0, 0, 0],
        [0, 0, 10],
      ]);
      const projection = tool._checkVisibility(viewport, item.data.handles.points, item.data);
      expect(projection.isVisible).toBe(true);
      expect(projection.isEndView).toBe(endView);
      expect(projection.drawWidthPx).toBeCloseTo(4);
    }
  });
  it('finishes placement once and permits dragging the placed implant while preserving its size', () => {
    const onPlaced = jest.fn();
    const tool = new DentalImplantTool({
      configuration: { onPlaced, implant: { dimensions: { length: 10, diameter: 4 } } },
    });
    const element = document.createElement('div');
    element.getBoundingClientRect = () => ({ width: 100, height: 100 }) as DOMRect;
    const viewport = {
      type: 'orthographic',
      getCamera: () => ({ viewPlaneNormal: [0, 0, 1], viewUp: [0, 1, 0], focalPoint: [0, 0, 0] }),
      getFrameOfReferenceUID: () => 'frame',
      getVolumeId: () => 'volume',
    };
    (getEnabledElement as jest.Mock).mockReturnValue({ viewport });
    const item = tool.addNewAnnotation({
      detail: { element, currentPoints: { world: [0, 0, 0] } },
    });
    jest.advanceTimersByTime(0);
    expect(onPlaced).toHaveBeenCalledTimes(1);
    expect(item.isVisible).toBe(true);
    tool.toolSelectedCallback({ detail: { element } } as any, item as any);
    tool._dragCallback({
      detail: { element, currentPoints: { canvas: [20, 20] }, deltaPoints: { world: [1, 2, 3] } },
    } as any);
    tool._endCallback({ detail: { element, currentPoints: { canvas: [20, 20] } } } as any);
    expect(item.data.handles.points).toEqual([
      [1, 2, 3],
      [1, 2, 13],
    ]);
    expect(annotation.state.removeAnnotation).not.toHaveBeenCalled();
  });
  it.each([
    [-1, 20],
    [101, 20],
    [20, -1],
    [20, 101],
  ])('deletes only on drop outside the original pane (%s, %s)', (x, y) => {
    const tool = new DentalImplantTool();
    const element = document.createElement('div');
    element.getBoundingClientRect = () => ({ width: 100, height: 100 }) as DOMRect;
    const item = {
      annotationUID: 'placed',
      invalidated: false,
      data: {
        handles: {
          points: [
            [0, 0, 0],
            [0, 0, 10],
          ],
        },
      },
    };
    tool.toolSelectedCallback({ detail: { element } } as any, item as any);
    tool._dragCallback({
      detail: { element, currentPoints: { canvas: [x, y] }, deltaPoints: { world: [0, 0, 0] } },
    } as any);
    expect(element.classList.contains('implant-drag-delete')).toBe(true);
    expect(annotation.state.removeAnnotation).not.toHaveBeenCalled();
    tool._endCallback({ detail: { element, currentPoints: { canvas: [x, y] } } } as any);
    expect(annotation.state.removeAnnotation).toHaveBeenCalledWith('placed');
    expect(element.classList.contains('implant-drag-delete')).toBe(false);
  });
  it('keeps an implant when the pointer returns inside before release or Escape cancels the drag', () => {
    const tool = new DentalImplantTool();
    const element = document.createElement('div');
    element.getBoundingClientRect = () => ({ width: 100, height: 100 }) as DOMRect;
    const item = {
      annotationUID: 'placed',
      invalidated: false,
      data: {
        handles: {
          points: [
            [0, 0, 0],
            [0, 0, 10],
          ],
        },
      },
    };
    tool.toolSelectedCallback({ detail: { element } } as any, item as any);
    tool._dragCallback({
      detail: { element, currentPoints: { canvas: [-10, 0] }, deltaPoints: { world: [1, 0, 0] } },
    } as any);
    tool._endCallback({ detail: { element, currentPoints: { canvas: [20, 20] } } } as any);
    expect(annotation.state.removeAnnotation).not.toHaveBeenCalled();
    tool.toolSelectedCallback({ detail: { element } } as any, item as any);
    tool._dragCallback({
      detail: { element, currentPoints: { canvas: [-10, 0] }, deltaPoints: { world: [2, 0, 0] } },
    } as any);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(annotation.state.removeAnnotation).not.toHaveBeenCalled();
    expect(item.data.handles.points).toEqual([
      [1, 0, 0],
      [1, 0, 10],
    ]);
  });

  function rotationFixture() {
    const tool = new DentalImplantTool(),
      element = document.createElement('div');
    element.getBoundingClientRect = () => ({ width: 500, height: 500 }) as DOMRect;
    (getEnabledElement as jest.Mock).mockReturnValue({
      viewport: {
        type: 'orthographic',
        getVolumeId: () => 'volume',
        getCamera: () => ({ viewPlaneNormal: [0, 1, 0], focalPoint: [0, 0, 0] }),
        worldToCanvas: p => [p[0] * 10, p[2] * 10],
      },
    });
    const item = {
      annotationUID: 'rotating',
      metadata: { dentalVolumeId: 'volume' },
      invalidated: false,
      data: {
        handles: {
          points: [
            [0, 0, 0],
            [0, 0, 10],
          ],
        },
        implant: { dimensions: { diameter: 4, length: 10 } },
      },
    };
    const event = (world, canvas = [100, 100]) =>
      ({
        detail: { element, currentPoints: { world, canvas }, deltaPoints: { world: [0, 0, 0] } },
      }) as any;
    return { tool, element, item, event };
  }
  it('rotates by the apex handle in MPR with no scaling and keeps the platform fixed', () => {
    const { tool, element, item, event } = rotationFixture();
    expect(tool.getHandleNearImagePoint(element, item, [0, 100], 6)).toBe(
      item.data.handles.points[1]
    );
    tool.handleSelectedCallback(event([0, 0, 10]), item, item.data.handles.points[1]);
    tool._dragCallback(event([100, 0, 0]));
    tool._endCallback(event([100, 0, 0]));
    expect(item.data.handles.points[0]).toEqual([0, 0, 0]);
    expect(item.data.handles.points[1][0]).toBeCloseTo(10);
    expect(item.data.handles.points[1][2]).toBeCloseTo(0);
    expect(Math.hypot(...item.data.handles.points[1])).toBeCloseTo(10);
    expect(annotation.state.removeAnnotation).not.toHaveBeenCalled();
  });
  it.each(['pointercancel', 'blur', 'lostpointercapture', 'volume'])(
    'rolls back a rotation on %s and ignores late motion',
    name => {
      const { tool, element, item, event } = rotationFixture();
      tool.handleSelectedCallback(event([0, 0, 10]), item, item.data.handles.points[1]);
      tool._dragCallback(event([10, 0, 0]));
      if (name === 'volume') element.dispatchEvent(new Event('new-volume'));
      else window.dispatchEvent(new Event(name));
      tool._dragCallback(event([-10, 0, 0]));
      expect(item.data.handles.points).toEqual([
        [0, 0, 0],
        [0, 0, 10],
      ]);
      expect(tool.editData).toBeNull();
    }
  );
  it('uses a finite ellipse and cap clipping instead of a midpoint visibility shortcut', () => {
    const { tool } = rotationFixture(),
      c = Math.SQRT1_2;
    const viewport = {
      type: 'orthographic',
      getCamera: () => ({ focalPoint: [0, 0, 0], viewPlaneNormal: [0, 0, 1] }),
      worldToCanvas: p => [p[0], p[1]],
    };
    const vis = tool._checkVisibility(
      viewport,
      [
        [-10 * c, 0, -10 * c],
        [10 * c, 0, 10 * c],
      ],
      { implant: { dimensions: { diameter: 4 } } }
    );
    expect(vis.isVisible).toBe(true);
    expect(vis.drawWidthPx).toBeCloseTo(4 * Math.SQRT2);
    expect(
      tool._checkVisibility(
        viewport,
        [
          [0, 0, 1],
          [0, 0, 11],
        ],
        {}
      ).isVisible
    ).toBe(false);
  });
  it('applies one editor transaction and rejects a stale volume', () => {
    const { tool, element, item } = rotationFixture(),
      memo = jest.spyOn(tool, 'createMemo'),
      done = jest.spyOn(tool, 'doneEditMemo');
    const model = { dimensions: { length: 8, diameter: 3.5 } };
    expect(
      tool.updateImplant(
        element,
        item,
        [
          [1, 2, 3],
          [1, 2, 11],
        ],
        model
      )
    ).toBe(true);
    expect(item.data.handles.points).toEqual([
      [1, 2, 3],
      [1, 2, 11],
    ]);
    expect(item.data.implant).toBe(model);
    expect(memo).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledTimes(1);
    item.metadata.dentalVolumeId = 'another';
    expect(
      tool.updateImplant(
        element,
        item,
        [
          [0, 0, 0],
          [0, 0, 8],
        ],
        model
      )
    ).toBe(false);
    expect(item.data.handles.points[0]).toEqual([1, 2, 3]);
  });
});
