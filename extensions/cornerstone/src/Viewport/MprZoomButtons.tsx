import React from 'react';
import { getEnabledElement } from '@cornerstonejs/core';
import { ToolGroupManager } from '@cornerstonejs/tools';
import zoomMprViewport from '../utils/zoomMprViewport';

const labels = { 'mpr-coronal': 'корональное окно', 'mpr-sagittal': 'сагиттальное окно', 'mpr-axial': 'аксиальное окно' };

export default function MprZoomButtons({ viewportId, element, viewportGridService }) {
  if (!labels[viewportId]) return null;
  return <>
    {[{ factor: 1.25, symbol: '+', action: 'Увеличить', className: 'mpr-zoom-in' },
      { factor: 0.8, symbol: '−', action: 'Уменьшить', className: 'mpr-zoom-out' }].map(button => (
      <button
        key={button.symbol}
        className={`mpr-focus-button ${button.className}`}
        type="button"
        disabled={!element}
        aria-label={`${button.action} ${labels[viewportId]}`}
        title={`${button.action} ${labels[viewportId]} · вокруг крестика`}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => {
          event.stopPropagation();
          const enabled = getEnabledElement(element);
          if (!enabled) return;
          viewportGridService.setActiveViewportId(viewportId);
          const tool = ToolGroupManager.getToolGroupForViewport(viewportId, enabled.renderingEngine.id)?.getToolInstance('Crosshairs');
          zoomMprViewport(enabled.viewport, button.factor, tool?.toolCenter);
        }}
      >{button.symbol}</button>
    ))}
  </>;
}
