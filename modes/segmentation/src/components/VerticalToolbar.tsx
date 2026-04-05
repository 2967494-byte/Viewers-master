import React from 'react';
import { Toolbar } from '@ohif/extension-default';

/**
 * Вертикальный левый тулбар — отображает primary кнопки вертикально.
 * Используется вместо горизонтального верхнего тулбара в segmentation режиме.
 */
export function VerticalToolbar() {
  return (
    <div
      className="flex flex-col items-center gap-1 py-2 px-1 bg-secondary-dark border-r border-secondary-light h-full overflow-y-auto"
      style={{ minWidth: '52px', width: '52px' }}
    >
      <Toolbar buttonSection="primary" />
    </div>
  );
}

export default VerticalToolbar;
