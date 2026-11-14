import React, { useEffect, useState } from 'react';
import { getFocusedMprViewport, MPR_VIEWPORT_IDS, setMprFocus } from '../utils/mprFocusLayout';

const labels = {
  'mpr-coronal': 'корональное окно',
  'mpr-sagittal': 'сагиттальное окно',
  'mpr-axial': 'аксиальное окно',
  'mpr-3d': '3D-окно',
};

export default function MprFocusButton({ viewportId, viewportGridService }) {
  const [focusedId, setFocusedId] = useState<string>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const update = () => setFocusedId(getFocusedMprViewport(viewportGridService.getState()));
    const { unsubscribe } = viewportGridService.subscribe(
      viewportGridService.EVENTS.GRID_STATE_CHANGED,
      update
    );
    update();
    return unsubscribe;
  }, [viewportGridService]);
  const expanded = focusedId === viewportId;
  useEffect(() => {
    if (!expanded) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.body.classList.contains('manual-panorama-active')) {
        setMprFocus(viewportGridService, null);
      }
    };
    // OHIF hotkeys stop bubbling at document; window capture must see Escape first.
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [expanded, viewportGridService]);
  if (!MPR_VIEWPORT_IDS.includes(viewportId)) return null;
  const title = expanded ? 'Вернуть четыре окна' : `Развернуть ${labels[viewportId]}`;
  return (
    <button
      className="mpr-focus-button"
      aria-label={title}
      title={title}
      aria-pressed={expanded}
      disabled={pending}
      onPointerDown={event => event.stopPropagation()}
      onClick={async event => {
        event.stopPropagation();
        if (pending) return;
        setPending(true);
        try {
          await setMprFocus(viewportGridService, expanded ? null : viewportId);
        } finally {
          setPending(false);
        }
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width="19"
        height="19"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path
          d={
            expanded
              ? 'M3 8h5V3 M21 8h-5V3 M3 16h5v5 M21 16h-5v5'
              : 'M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5'
          }
        />
      </svg>
    </button>
  );
}
