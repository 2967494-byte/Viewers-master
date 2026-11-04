import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { eventTarget, getEnabledElement } from '@cornerstonejs/core';
import { annotation } from '@cornerstonejs/tools';
import ImplantEditor from './ImplantEditor';
import { IMPLANT_DATA } from './implantData';

jest.mock('@cornerstonejs/core', () => ({
  getEnabledElement: jest.fn(),
  eventTarget: new EventTarget(),
  Enums: { Events: { VOLUME_VIEWPORT_NEW_VOLUME: 'volume', ELEMENT_DISABLED: 'disabled' } },
}));
jest.mock('@cornerstonejs/tools', () => ({
  annotation: {
    state: { getAnnotation: jest.fn() },
    selection: { isAnnotationSelected: () => true },
    visibility: { isAnnotationVisible: () => true },
    locking: { isAnnotationLocked: () => false },
  },
  Enums: {
    Events: {
      ANNOTATION_MODIFIED: 'modified',
      ANNOTATION_REMOVED: 'removed',
      ANNOTATION_SELECTION_CHANGE: 'selected',
      ANNOTATION_VISIBILITY_CHANGE: 'visible',
      ANNOTATION_LOCK_CHANGE: 'locked',
    },
  },
}));

function setup() {
  const element = document.createElement('div'),
    model = IMPLANT_DATA[0].lines[0].models[0];
  const item = {
    annotationUID: 'one',
    metadata: { dentalVolumeId: 'one-volume' },
    data: {
      implant: model,
      handles: {
        points: [
          [1, 2, 3],
          [1, 2, 3 + model.dimensions.length],
        ],
      },
    },
  };
  const tool = { updateImplant: jest.fn(() => true), cancel: jest.fn() };
  (getEnabledElement as jest.Mock).mockReturnValue({
    viewport: { getVolumeId: () => 'one-volume' },
  });
  (annotation.state.getAnnotation as jest.Mock).mockReturnValue(item);
  const view = render(React.createElement(ImplantEditor, { element }));
  act(() =>
    window.dispatchEvent(
      new CustomEvent('orbital:implant-edit', { detail: { element, item, tool } })
    )
  );
  return { ...view, element, item, model, tool };
}
describe('Installed implant editor', () => {
  it('does not round the world axis when changing only a model', () => {
    const { item, model, getByLabelText, getByRole, tool } = setup();
    const axis = [0.123456789, 0.314159265, Math.sqrt(1 - 0.123456789 ** 2 - 0.314159265 ** 2)];
    item.data.handles.points[1] = item.data.handles.points[0].map(
      (v, i) => v + axis[i] * model.dimensions.length
    );
    act(() => eventTarget.dispatchEvent(new Event('modified')));
    const replacement = IMPLANT_DATA[0].lines[0].models[1];
    fireEvent.change(getByLabelText('Типоразмер установленного импланта'), {
      target: { value: replacement.id },
    });
    fireEvent.click(getByRole('button', { name: 'Применить' }));
    const points = tool.updateImplant.mock.calls[0][2];
    points[1].forEach((v, i) =>
      expect((v - points[0][i]) / replacement.dimensions.length).toBeCloseTo(axis[i], 10)
    );
  });
  it('applies model and axis shift once, preserving the platform/axis on model-only edits', () => {
    const { getByLabelText, getByRole, tool, item, element } = setup();
    const model = IMPLANT_DATA[0].lines[0].models[1];
    fireEvent.change(getByLabelText('Типоразмер установленного импланта'), {
      target: { value: model.id },
    });
    expect(tool.updateImplant).not.toHaveBeenCalled();
    fireEvent.click(getByRole('button', { name: 'Применить' }));
    expect(tool.updateImplant).toHaveBeenCalledTimes(1);
    expect(tool.updateImplant).toHaveBeenCalledWith(
      element,
      item,
      [
        [1, 2, 3],
        [1, 2, 3 + model.dimensions.length],
      ],
      model
    );
  });
  it('changes direction and tilt with fixed catalog length and an explicit apply', () => {
    const { getByLabelText, getByRole, tool, model } = setup();
    fireEvent.click(getByRole('button', { name: 'Вертикально вниз' }));
    fireEvent.change(getByLabelText('Наклон импланта XZ'), { target: { value: 30 } });
    fireEvent.change(getByLabelText('Смещение импланта вдоль оси'), { target: { value: 2 } });
    fireEvent.click(getByRole('button', { name: 'Применить' }));
    const points = tool.updateImplant.mock.calls[0][2];
    expect(points[0][0]).toBeCloseTo(2);
    expect(points[0][2]).toBeCloseTo(3 - Math.sqrt(3));
    expect(Math.hypot(...points[1].map((v, i) => v - points[0][i]))).toBeCloseTo(
      model.dimensions.length
    );
  });
  it('rejects empty/invalid angles and closes without applying drafts on Escape', () => {
    const { getByLabelText, getByRole, queryByRole, tool } = setup();
    fireEvent.change(getByLabelText('Наклон импланта XZ'), { target: { value: '' } });
    expect((getByRole('button', { name: 'Применить' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(getByLabelText('Наклон импланта XZ'), { key: 'Escape' });
    expect(tool.cancel).toHaveBeenCalledTimes(1);
    expect(queryByRole('form')).toBeNull();
    expect(tool.updateImplant).not.toHaveBeenCalled();
  });
  it('closes on a new volume or deletion and refreshes fields from undo/redo events', () => {
    const { element, item, getByLabelText, queryByRole } = setup();
    item.data.handles.points[1] = [1, 2, -7];
    act(() => eventTarget.dispatchEvent(new Event('modified')));
    expect((getByLabelText('Наклон импланта XZ') as HTMLInputElement).value).toBe('0');
    act(() => element.dispatchEvent(new Event('volume')));
    expect(queryByRole('form')).toBeNull();
  });
});
