import { activateDentalTool } from './dentalToolControls';
jest.mock('./implantDragPriority', () => ({ installImplantDragPriority: jest.fn() }));

const makeGroup = (id, primary) => ({
  id,
  hasTool: jest.fn(() => true),
  getActivePrimaryMouseButtonTool: () => primary,
  setToolActive: jest.fn(),
  setToolPassive: jest.fn(),
  setToolDisabled: jest.fn(),
  setToolConfiguration: jest.fn(),
});

describe('Dental toolbar tool bindings', () => {
  it('activates primary Pan in MPR and 3D and protects panning from passive annotation selection', () => {
    const pan = {} as any;
    const groups = [makeGroup('mpr', 'Crosshairs'), makeGroup('mpr-3d', 'TrackballRotate')];
    groups.forEach(group => { group['getToolInstance'] = () => pan; });
    expect(activateDentalTool(groups, 'pan')).toBe(true);
    for (const group of groups) {
      expect(group.setToolActive).toHaveBeenCalledWith('Pan', { bindings: [{ mouseButton: 1 }] });
      expect(group.setToolPassive).not.toHaveBeenCalledWith('Zoom');
      expect(group.setToolDisabled).not.toHaveBeenCalled();
    }
    const event = { preventDefault: jest.fn() };
    expect(pan.preMouseDownCallback(event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
  });
  it('activates the read-only loupe in both panes and preserves pan and zoom', () => {
    const groups = [makeGroup('mpr', 'Crosshairs'), makeGroup('mpr-3d', 'TrackballRotate')];
    activateDentalTool(groups, 'magnify');
    for (const group of groups) {
      expect(group.setToolActive).toHaveBeenCalledWith('DentalMagnify', { bindings: [{ mouseButton: 1 }] });
      expect(group.setToolPassive).not.toHaveBeenCalledWith('Pan');
      expect(group.setToolPassive).not.toHaveBeenCalledWith('Zoom');
    }
    activateDentalTool(groups, 'navigate');
    expect(groups[0].setToolActive).toHaveBeenLastCalledWith('Crosshairs', expect.anything());
    expect(groups[1].setToolActive).toHaveBeenLastCalledWith('TrackballRotate', expect.anything());
  });
  it('activates spatial tools in both MPR and 3D, preserving auxiliary bindings', () => {
    const mpr = makeGroup('mpr', 'Crosshairs'),
      vr = makeGroup('mpr-3d', 'TrackballRotate');
    expect(activateDentalTool([mpr, vr], 'length3d')).toBe(true);
    for (const group of [mpr, vr]) {
      expect(group.setToolActive).toHaveBeenCalledWith('DentalLength3D', {
        bindings: [{ mouseButton: 1 }],
      });
      expect(group.setToolDisabled).not.toHaveBeenCalled();
      expect(group.setToolPassive).not.toHaveBeenCalledWith('Zoom');
      expect(group.setToolPassive).not.toHaveBeenCalledWith('Pan');
    }
  });
  it('keeps rotation in 3D when choosing a planar measurement', () => {
    const mpr = makeGroup('mpr', 'DentalCanal'),
      vr = makeGroup('mpr-3d', 'DentalCanal');
    activateDentalTool([mpr, vr], 'angle2d');
    expect(mpr.setToolActive).toHaveBeenCalledWith('Angle', expect.anything());
    expect(vr.setToolActive).toHaveBeenCalledWith('TrackballRotate', expect.anything());
    activateDentalTool([mpr, vr], 'navigate');
    expect(mpr.setToolActive).toHaveBeenCalledWith('Crosshairs', expect.anything());
  });
  it('passes the model and one-shot callback to MPR, preserves 3D rotation and ignores unrelated groups', () => {
    const mpr = makeGroup('mpr', 'Crosshairs'),
      vr = makeGroup('mpr-3d', 'TrackballRotate'),
      other = makeGroup('other', 'Pan');
    const model = { dimensions: { length: 10, diameter: 4 } };
    const onPlaced = jest.fn();
    activateDentalTool([mpr, vr, other], 'implant', model, onPlaced);
    expect(mpr.setToolConfiguration).toHaveBeenCalledWith('DentalImplant', {
      implant: model,
      onPlaced,
    });
    expect(vr.setToolActive).toHaveBeenCalledWith('TrackballRotate', expect.anything());
    expect(vr.setToolConfiguration).not.toHaveBeenCalled();
    expect(other.setToolActive).not.toHaveBeenCalled();
    expect(activateDentalTool([mpr], 'unknown')).toBe(false);
  });
});
