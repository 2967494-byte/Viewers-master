import { recordViewerEvent } from '@ohif/core/src/constants/orbitalViewerDiagnostics';
export const MPR_VIEWPORT_IDS = ['mpr-coronal', 'mpr-sagittal', 'mpr-axial', 'mpr-3d'];

export function mprFocusRectangles(focusedId: string | null) {
  if (!focusedId)
    return MPR_VIEWPORT_IDS.map((id, index) => ({
      x: (index % 2) / 2,
      y: Math.floor(index / 2) / 2,
      width: 0.5,
      height: 0.5,
    }));
  let sidebarRow = 0;
  return MPR_VIEWPORT_IDS.map(id =>
    id === focusedId
      ? { x: 0, y: 0, width: 0.75, height: 1 }
      : { x: 0.75, y: sidebarRow++ / 3, width: 0.25, height: 1 / 3 }
  );
}

export function getFocusedMprViewport(state): string | null {
  if (state.viewports.size !== 4 || !MPR_VIEWPORT_IDS.every(id => state.viewports.has(id)))
    return null;
  return (
    MPR_VIEWPORT_IDS.find(id => {
      const viewport = state.viewports.get(id);
      return viewport.width > 0.7 && viewport.height > 0.99;
    }) || null
  );
}

/** Keep all four viewport IDs/options, so React moves the existing live renderers. */
export async function setMprFocus(viewportGridService, focusedId: string | null) {
  const state = viewportGridService.getState();
  if (state.viewports.size !== 4 || !MPR_VIEWPORT_IDS.every(id => state.viewports.has(id))) return;
  if (focusedId && !MPR_VIEWPORT_IDS.includes(focusedId)) return;
  recordViewerEvent('layout', { value: focusedId || 'grid' });
  const rectangles = mprFocusRectangles(focusedId);
  // This changes geometry only. setLayout would mark the existing renderers unready.
  viewportGridService.set({
    ...state,
    layout: { ...state.layout, numRows: 2, numCols: 2 },
    viewports: new Map(
      MPR_VIEWPORT_IDS.map((id, index) => [
        id,
        {
          ...state.viewports.get(id),
          ...rectangles[index],
        },
      ])
    ),
    activeViewportId: focusedId || state.activeViewportId,
  });
}
