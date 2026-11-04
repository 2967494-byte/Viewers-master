import { annotation } from '@cornerstonejs/tools';
import { installImplantDragPriority } from './implantDragPriority';

jest.mock('@cornerstonejs/tools', () => ({
  annotation: {
    state: { getAnnotations: jest.fn() },
    visibility: { isAnnotationVisible: jest.fn(() => true) },
    locking: { isAnnotationLocked: jest.fn(() => false) },
    selection: { setAnnotationSelected: jest.fn() },
  },
}));

function setup(hit = true) {
  const previous = jest.fn(() => false);
  const navigation = { preMouseDownCallback: previous };
  const implant = {
    filterInteractableAnnotationsForElement: (_element, items) => items,
    isPointNearTool: jest.fn(() => hit),
    toolSelectedCallback: jest.fn(),
  };
  const group = { getToolInstance: name => (name === 'Crosshairs' ? navigation : implant) };
  const item = { annotationUID: 'placed' };
  (annotation.state.getAnnotations as jest.Mock).mockReturnValue([item]);
  const event = {
    detail: {
      event: { buttons: 1 },
      element: document.createElement('div'),
      currentPoints: { canvas: [10, 20] },
    },
    preventDefault: jest.fn(),
  };
  installImplantDragPriority(group, 'Crosshairs');
  return { group, navigation, implant, previous, item, event };
}

describe('Implant dragging takes priority over slice navigation', () => {
  beforeEach(() => jest.clearAllMocks());
  it('selects an implant under the cursor before a crosshair can consume the click', () => {
    const { group, navigation, implant, previous, item, event } = setup();
    installImplantDragPriority(group, 'Crosshairs');
    expect(navigation.preMouseDownCallback(event)).toBe(true);
    expect(implant.toolSelectedCallback).toHaveBeenCalledTimes(1);
    expect(implant.toolSelectedCallback).toHaveBeenCalledWith(event, item);
    expect(annotation.selection.setAnnotationSelected).toHaveBeenCalledWith('placed');
    expect(previous).not.toHaveBeenCalled();
  });
  it('preserves navigation away from the implant and preserves other mouse buttons', () => {
    const { navigation, implant, previous, event } = setup(false);
    expect(navigation.preMouseDownCallback(event)).toBe(false);
    expect(previous).toHaveBeenCalledWith(event);
    implant.isPointNearTool.mockReturnValue(true);
    event.detail.event.buttons = 2;
    navigation.preMouseDownCallback(event);
    expect(implant.toolSelectedCallback).not.toHaveBeenCalled();
    expect(previous).toHaveBeenCalledTimes(2);
  });
  it('does not drag locked annotations', () => {
    const { navigation, implant, previous, event } = setup();
    (annotation.locking.isAnnotationLocked as jest.Mock).mockReturnValueOnce(true);
    navigation.preMouseDownCallback(event);
    expect(implant.toolSelectedCallback).not.toHaveBeenCalled();
    expect(previous).toHaveBeenCalledTimes(1);
  });
  it('routes a visible rotation handle before navigation or body translation', () => {
    const { navigation, implant, event, item } = setup();
    const handle = [1, 2, 3];
    Object.assign(implant, {
      getHandleNearImagePoint: jest.fn(() => handle),
      handleSelectedCallback: jest.fn(),
    });
    navigation.preMouseDownCallback(event);
    expect((implant as any).handleSelectedCallback).toHaveBeenCalledWith(event, item, handle);
    expect(implant.toolSelectedCallback).not.toHaveBeenCalled();
  });
});
