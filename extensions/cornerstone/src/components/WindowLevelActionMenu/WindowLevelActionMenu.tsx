import React, { ReactElement, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AllInOneMenu } from '@ohif/ui-next';
import { Colormap } from './Colormap';
import { VolumeRenderingPresets } from './VolumeRenderingPresets';
import { VolumeRenderingOptions } from './VolumeRenderingOptions';
import { useViewportRendering } from '../../hooks/useViewportRendering';
import i18n from 'i18next';

export type WindowLevelActionMenuProps = {
  viewportId: string;
  element?: HTMLElement;
  align?: 'start' | 'end' | 'center';
  side?: 'top' | 'bottom' | 'left' | 'right';
  onClose?: () => void;
};

export function WindowLevelActionMenu({
  viewportId,
  element,
  align,
  side,
  onClose,
}: WindowLevelActionMenuProps): ReactElement {
  return (
    <WindowLevelActionMenuContent
      viewportId={viewportId}
      align={align}
      side={side}
      onClose={onClose}
    />
  );
}

export function WindowLevelActionMenuContent({
  viewportId,
  align,
  side,
  onClose,
}: {
  viewportId: string;
  align?: string;
  side?: string;
  onClose?: () => void;
}): ReactElement {
  const { t } = useTranslation('WindowLevelActionMenu');
  // Use a stable key for the menu to avoid infinite re-renders
  const menuKey = useMemo(() => `${viewportId}`, [viewportId]);

  const {
    is3DVolume,
    colorbarProperties,
    volumeRenderingPresets,
    volumeRenderingQualityRange,
  } = useViewportRendering(viewportId);

  return (
    <AllInOneMenu.Menu
      key={menuKey}
      // the visibility is handled by the parent component
      isVisible={true}
      align={align}
      side={side}
      backLabel={i18n.t('WindowLevelActionMenu:Back to Display Options')}
      onVisibilityChange={visible => {
        if (!visible) {
          onClose?.();
        }
      }}
    >
      {!is3DVolume ? (
        colorbarProperties?.colormaps && <Colormap viewportId={viewportId} />
      ) : (
        <AllInOneMenu.ItemPanel>
          {volumeRenderingPresets && <VolumeRenderingPresets viewportId={viewportId} />}

          {volumeRenderingQualityRange && (
            <AllInOneMenu.SubMenu itemLabel={t('Rendering Options')}>
              <VolumeRenderingOptions viewportId={viewportId} />
            </AllInOneMenu.SubMenu>
          )}
        </AllInOneMenu.ItemPanel>
      )}
    </AllInOneMenu.Menu>
  );
}
