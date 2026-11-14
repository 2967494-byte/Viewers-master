import React, { ReactElement, useState } from 'react';
import { AllInOneMenu, ScrollArea, Tabs, TabsList, TabsTrigger } from '@ohif/ui-next';
import { useViewportRendering } from '../../hooks/useViewportRendering';
import { useTranslation } from 'react-i18next';

export function Colormap({ viewportId }: { viewportId?: string } = {}): ReactElement {
  const { viewportDisplaySets } = useViewportRendering(viewportId);
  const { t } = useTranslation('WindowLevelActionMenu');

  const [activeDisplaySetUID, setActiveDisplaySetUID] = useState<string | undefined>(
    viewportDisplaySets?.[0]?.displaySetInstanceUID
  );

  // Use the hook with the active display set
  const { colorbarProperties, setColormap } = useViewportRendering(viewportId, {
    displaySetInstanceUID: activeDisplaySetUID,
  });

  const { colormaps } = colorbarProperties;

  const handleSetColorLUT = (colormap, immediate = true) => {
    // Check if it's a fusion viewport
    const oneOpacityColormaps = ['Grayscale', 'X Ray'];
    const opacity =
      viewportDisplaySets.length > 1 && !oneOpacityColormaps.includes(colormap.name) ? 0.5 : 1;

    setColormap({
      colormap,
      opacity,
      immediate,
    });
  };

  return (
    <>
      {viewportDisplaySets && viewportDisplaySets.length > 1 && (
        <div className="flex h-8 w-full flex-shrink-0 items-center justify-center px-2 text-base">
          <Tabs
            value={activeDisplaySetUID}
            onValueChange={setActiveDisplaySetUID}
          >
            <TabsList>
              {viewportDisplaySets.map(ds => (
                <TabsTrigger
                  key={ds.displaySetInstanceUID}
                  value={ds.displaySetInstanceUID}
                >
                  {ds.Modality}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      )}

      <div className="h-[300px] flex-grow">
        <ScrollArea className="h-full w-full">
          <div className="p-1">
            {colormaps.map((colormap, index) => (
              <AllInOneMenu.Item
                key={index}
                label={t(`Colormaps:${colormap.Name}`, { defaultValue: colormap.Name })}
                useIconSpace={false}
                onClick={() => handleSetColorLUT(colormap)}
              />
            ))}
          </div>
        </ScrollArea>
      </div>
    </>
  );
}
