import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import ViewerViewportGrid from './ViewportGrid';
import { useAppConfig } from '@state';
import { useViewportGrid } from '@ohif/ui-next';

jest.mock('@state', () => ({ useAppConfig: jest.fn() }), { virtual: true });
jest.mock('react-dnd', () => ({ useDrop: () => [{}, () => {}] }));
jest.mock('@ohif/ui-next', () => ({
  ViewportGrid: ({ children }) => children,
  ViewportPane: jest.requireActual('../../../ui-next/src/components/Viewport/ViewportPane').ViewportPane,
  useViewportGrid: jest.fn(),
}));

describe('First gesture in another viewport', () => {
  let grid;
  const mount = (config = {}) => {
    (useAppConfig as jest.Mock).mockReturnValue([config]);
    const state = {
      layout: { numCols: 2, numRows: 1 },
      activeViewportId: 'mpr-coronal',
      viewports: new Map(['mpr-coronal', 'mpr-axial'].map((id, i) => [id, {
        viewportOptions: { viewportId: id },
        displaySetInstanceUIDs: [],
        x: i / 2, y: 0, width: 0.5, height: 1,
      }])),
    };
    grid = {
      getState: () => state,
      getNumViewportPanes: () => 2,
      getGridViewportsReady: () => false,
      getLayoutOptionsFromState: () => [],
      setActiveViewportId: jest.fn(),
    };
    (useViewportGrid as jest.Mock).mockReturnValue([state, grid]);
    return render(React.createElement(ViewerViewportGrid, {
      servicesManager: { services: {
        displaySetService: {},
        hangingProtocolService: {
          EVENTS: {}, subscribe: () => ({ unsubscribe: () => {} }),
        },
        customizationService: {},
      } },
    } as any));
  };

  it.each([{}, { activateViewportBeforeInteraction: false }])(
    'activates the inactive pane without cancelling its first pointer or wheel gesture (%j)',
    config => {
      const view = mount(config);
      const panes = view.container.querySelectorAll('[data-cy="viewport-pane"]');
      const pointer = new Event('pointerdown', { bubbles: true, cancelable: true });
      fireEvent(panes[1], pointer);
      expect(grid.setActiveViewportId).toHaveBeenCalledWith('mpr-axial');
      // Preventing pointerdown would suppress Cornerstone\'s native mousedown.
      expect(pointer.defaultPrevented).toBe(false);
      const wheel = new Event('wheel', { bubbles: true, cancelable: true });
      fireEvent(panes[1], wheel);
      expect(wheel.defaultPrevented).toBe(false);
    }
  );

  it('retains explicit selection-only behavior for integrations that request it', () => {
    const view = mount({ activateViewportBeforeInteraction: true });
    const pane = view.container.querySelectorAll('[data-cy="viewport-pane"]')[1];
    const event = new Event('pointerdown', { bubbles: true, cancelable: true });
    fireEvent(pane, event);
    expect(grid.setActiveViewportId).toHaveBeenCalledWith('mpr-axial');
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not reselect or cancel gestures in the active pane', () => {
    const view = mount();
    const pane = view.container.querySelector('[data-cy="viewport-pane"]');
    const event = new Event('pointerdown', { bubbles: true, cancelable: true });
    fireEvent(pane, event);
    expect(grid.setActiveViewportId).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
