import React, { useEffect } from 'react';
import { act, render } from '@testing-library/react';
import GraphicsRecoveryBoundary from './GraphicsRecoveryBoundary';
import { setGraphicsRecovery } from '@ohif/core/src/constants/orbitalGraphicsRecovery';
jest.mock('./StudyLoadingScreen/StudyLoadingScreen', () => () => require('react').createElement('div', null, 'Terminal failure'));
it('blocks interaction during recovery without remounting the viewer or changing its dimensions', async () => {
  const mounted = jest.fn(), unmounted = jest.fn();
  function Viewer() { useEffect(() => { mounted(); return unmounted; }, []); return React.createElement('canvas', { 'data-testid': 'scan', width: 800, height: 600 }); }
  const ui = render(React.createElement(GraphicsRecoveryBoundary, { children: React.createElement(Viewer) }));
  const canvas = ui.getByTestId('scan');
  await act(async () => { setGraphicsRecovery('waiting'); await Promise.resolve(); });
  expect(ui.getByRole('alertdialog')).toBeTruthy();
  expect(canvas.parentElement.hasAttribute('inert')).toBe(true);
  expect(ui.getByTestId('scan')).toBe(canvas); expect(canvas.getAttribute('width')).toBe('800');
  await act(async () => { setGraphicsRecovery('rebuilding'); await Promise.resolve(); });
  await act(async () => { setGraphicsRecovery('idle'); await Promise.resolve(); });
  expect(ui.queryByRole('alertdialog')).toBeNull();
  expect(canvas.parentElement.hasAttribute('inert')).toBe(false);
  expect(mounted).toHaveBeenCalledTimes(1); expect(unmounted).not.toHaveBeenCalled();
});
