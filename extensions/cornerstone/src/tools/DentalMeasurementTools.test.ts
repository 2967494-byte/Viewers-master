import { annotation, drawing } from '@cornerstonejs/tools';
import {
  DentalLength2DTool,
  DentalLength3DTool,
  DentalAngle3DTool,
  DentalTapeCurveTool,
  DentalCanalTool,
  hasDentalDraft,
} from './DentalMeasurementTools';

jest.mock('@cornerstonejs/tools', () => {
  const items = [];
  return {
    AnnotationTool: class {
      configuration;
      constructor(props, defaults) {
        this.configuration = { ...defaults.configuration, ...props.configuration };
      }
      getToolName() {
        return this.constructor['toolName'];
      }
      createMemo() {}
      doneEditMemo() {}
    },
    Enums: { Events: { MOUSE_DRAG: 'drag', MOUSE_UP: 'up' } },
    annotation: {
      state: {
        getAnnotations: jest.fn(name => items.filter(item => item.metadata.toolName === name)),
        addAnnotation: jest.fn(item => items.push(item)),
        removeAnnotation: jest.fn(id => {
          const i = items.findIndex(item => item.annotationUID === id);
          if (i >= 0) items.splice(i, 1);
        }),
        triggerAnnotationCompleted: jest.fn(),
        triggerAnnotationModified: jest.fn(),
        getAllAnnotations: () => items,
      },
      selection: { setAnnotationSelected: jest.fn() },
      visibility: { isAnnotationVisible: () => true },
      locking: { isAnnotationLocked: () => false },
    },
    drawing: { drawPolyline: jest.fn(), drawHandles: jest.fn(), drawTextBox: jest.fn() },
    utilities: { triggerAnnotationRender: jest.fn() },
  };
});
jest.mock('@cornerstonejs/core', () => ({
  Enums: { ViewportType: { VOLUME_3D: '3d', ORTHOGRAPHIC: '2d' } },
  getEnabledElement: element => ({ viewport: element.testViewport }),
  getEnabledElements: () => [],
  utilities: { uuidv4: () => Math.random().toString() },
}));
jest.mock('@kitware/vtk.js/Rendering/Core/CellPicker', () => ({
  __esModule: true,
  default: { newInstance: jest.fn() },
}));
jest.mock('@kitware/vtk.js/Common/DataModel/PolyData', () => ({ __esModule: true, default: {} }));
jest.mock('@kitware/vtk.js/Filters/General/TubeFilter', () => ({ __esModule: true, default: {} }));
jest.mock('@kitware/vtk.js/Rendering/Core/Mapper', () => ({ __esModule: true, default: {} }));
jest.mock('@kitware/vtk.js/Rendering/Core/Actor', () => ({ __esModule: true, default: {} }));

describe('Dental ruler persistence and spatial drawing', () => {
  let element, camera, viewport, tools;
  const click = (tool, world, target = element) =>
    tool.mouseClickCallback({
      detail: {
        element: target,
        currentPoints: { world, canvas: world.slice(0, 2) },
        event: { button: 0 },
      },
      preventDefault: jest.fn(),
    });
  beforeEach(() => {
    jest.clearAllMocks();
    element = document.createElement('div');
    camera = { focalPoint: [0, 0, 0], viewPlaneNormal: [0, 0, 1], viewUp: [0, 1, 0] };
    viewport = {
      element,
      id: 'axial',
      type: '2d',
      getVolumeId: () => 'volume',
      getFrameOfReferenceUID: () => 'frame',
      getCamera: () => camera,
      worldToCanvas: p => p.slice(0, 2),
    };
    element.testViewport = viewport;
    tools = [
      new DentalLength2DTool(),
      new DentalLength3DTool(),
      new DentalAngle3DTool(),
      new DentalTapeCurveTool(),
      new DentalCanalTool(),
    ];
  });
  afterEach(() => {
    tools.forEach(tool => tool.cancel());
    for (const item of [...annotation.state.getAllAnnotations()])
      annotation.state.removeAnnotation(item.annotationUID);
  });
  it('keeps 2D ruler points visible after scrolling and preserves the original measurement plane', () => {
    const tool = tools[0];
    click(tool, [0, 0, 0]);
    camera.focalPoint = [0, 0, 5];
    click(tool, [3, 4, 5]);
    const item = annotation.state.getAllAnnotations()[0];
    expect(item.data.handles.points).toEqual([
      [0, 0, 0],
      [3, 4, 0],
    ]);
    tool.renderAnnotation({ viewport }, {});
    expect(item.data.cachedStats.dental.value).toBe(5);
    expect(drawing.drawHandles).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'points',
      [
        [0, 0],
        [3, 4],
      ],
      expect.anything()
    );
    expect((drawing.drawTextBox as jest.Mock).mock.calls[0][3]).toEqual([
      '5.0 мм · 2D',
      'Вне среза: -5.0 мм',
    ]);
    camera.focalPoint = [0, 0, 25];
    tool.renderAnnotation({ viewport }, {});
    expect(item.data.handles.points).toEqual([
      [0, 0, 0],
      [3, 4, 0],
    ]);
    expect(item.data.cachedStats.dental.value).toBe(5);
  });
  it('continues a spatial measurement in another MPR pane and retains real depth', () => {
    const tool = tools[1];
    click(tool, [0, 0, 0]);
    const other = document.createElement('div') as any;
    other.testViewport = { ...viewport, element: other, id: 'sagittal' };
    click(tool, [3, 4, 12], other);
    tool.renderAnnotation({ viewport }, {});
    expect(annotation.state.getAllAnnotations()[0].data.cachedStats.dental.value).toBe(13);
    expect(annotation.state.triggerAnnotationCompleted).toHaveBeenCalledTimes(1);
  });
  it('finishes a non-coplanar angle at three points and a curve on Enter', () => {
    click(tools[2], [1, 0, 0]);
    click(tools[2], [0, 0, 0]);
    click(tools[2], [0, 0, 2]);
    tools[2].renderAnnotation({ viewport }, {});
    expect(annotation.state.getAllAnnotations()[0].data.cachedStats.dental.value).toBe(90);
    click(tools[3], [0, 0, 0]);
    click(tools[3], [5, 5, 2]);
    click(tools[3], [10, 0, 0]);
    expect(hasDentalDraft()).toBe(true);
    const hotkeys = (event: KeyboardEvent) => event.stopPropagation();
    document.addEventListener('keydown', hotkeys);
    try {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    } finally {
      document.removeEventListener('keydown', hotkeys);
    }
    expect(hasDentalDraft()).toBe(false);
    expect(annotation.state.getAllAnnotations()[1].data.dentalComplete).toBe(true);
  });
  it('cancels an unfinished canal without leaving a phantom annotation', () => {
    click(tools[4], [1, 2, 3]);
    click(tools[4], [3, 4, 5]);
    tools[4].onSetToolPassive();
    expect(annotation.state.getAllAnnotations()).toHaveLength(0);
    expect(annotation.state.triggerAnnotationCompleted).not.toHaveBeenCalled();
  });
  it('does not project a measurement into a different volume', () => {
    click(tools[1], [0, 0, 0]);
    click(tools[1], [1, 2, 3]);
    tools[1].renderAnnotation({ viewport: { ...viewport, getVolumeId: () => 'different' } }, {});
    expect(drawing.drawHandles).not.toHaveBeenCalled();
  });
});
