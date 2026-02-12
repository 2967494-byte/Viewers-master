import React from 'react';
import { id } from './id';
import toolbarButtons from './toolbarButtons';
import initToolGroups from './initToolGroups';
import setUpAutoTabSwitchHandler from './utils/setUpAutoTabSwitchHandler';
import { ohif, cornerstone, extensionDependencies, dicomRT, segmentation } from '@ohif/mode-basic';
export * from './toolbarButtons';

function modeFactory({ modeConfiguration }) {
  const _unsubscriptions = [];
  return {
    /**
     * Mode ID, which should be unique among modes used by the viewer. This ID
     * is used to identify the mode in the viewer's state.
     */
    id,
    routeName: 'segmentation',
    /**
     * Mode name, which is displayed in the viewer's UI in the workList, for the
     * user to select the mode.
     */
    displayName: 'Segmentation',
    /**
     * Runs when the Mode Route is mounted to the DOM. Usually used to initialize
     * Services and other resources.
     */
    onModeEnter: ({ servicesManager, extensionManager, commandsManager }: withAppTypes) => {
      const {
        measurementService,
        toolbarService,
        toolGroupService,
        segmentationService,
        viewportGridService,
        panelService,
        customizationService,
        cornerstoneViewportService,
      } = servicesManager.services;

      measurementService.clearMeasurements();

      // Init Default and SR ToolGroups
      initToolGroups(extensionManager, toolGroupService, commandsManager);

      customizationService.setCustomizations({
        'viewportOverlay.topLeft': [

          {
            id: 'Orientation',
            label: 'Orientation',
            contentF: ({ viewportId, servicesManager }) => {
              const { cornerstoneViewportService } = servicesManager.services;
              const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
              if (!viewport) return null;
              const options = cornerstoneViewportService.getViewportInfo(viewportId)?.viewportOptions;
              if (options?.orientation) {
                const orientation = options.orientation.toLowerCase();
                let colorClass = 'text-[#FFD700]'; // Default Coronal/Gold
                if (orientation === 'axial') {
                  colorClass = 'text-[#4ADE80]'; // Green
                } else if (orientation === 'sagittal') {
                  colorClass = 'text-[#F59E0B]'; // Orange
                }

                return (
                  <div className={`overlay-item flex flex-row text-[14px] leading-none font-normal ${colorClass} mb-2`}>
                    {options.orientation.charAt(0).toUpperCase() + options.orientation.slice(1)}
                  </div>
                );
              }
              return null;
            },
          },
          {
            id: 'PatientID',
            attribute: 'PatientID',
            label: '',
            contentF: ({ instance }) => {
              if (!instance) return null;
              return (
              <div className="overlay-item flex flex-row text-[10px] leading-3">
                <span className="text-[#b0b0b0] mr-1">ID :</span>
                <span className="text-white">{instance.PatientID}</span>
              </div>
            )},
          },
          {
            id: 'PatientName',
            attribute: 'PatientName',
            label: '',
            contentF: ({ instance, formatters }) => {
              if (!instance) return null;
              const { PatientName } = instance;
              let nameToFormat = PatientName;

              // Handle DICOM PN object structure (Alphabetic, Ideographic, Phonetic)
              if (typeof PatientName === 'object' && PatientName !== null) {
                 if (PatientName.Alphabetic) {
                    nameToFormat = PatientName.Alphabetic;
                 } else if (Array.isArray(PatientName) && PatientName.length > 0) {
                    nameToFormat = PatientName[0];
                 } else {
                    // Fallback to stringifying or taking the first value
                    nameToFormat = Object.values(PatientName).join(' ');
                 }
              }

              if (
                typeof nameToFormat === 'string' &&
                /[\u00C0-\u00FF]/.test(nameToFormat) &&
                !/[\u0400-\u04FF]/.test(nameToFormat)
              ) {
                try {
                    const bytes = new Uint8Array(nameToFormat.length);
                    for (let i = 0; i < nameToFormat.length; i++) {
                    bytes[i] = nameToFormat.charCodeAt(i);
                    }
                    const decoder = new TextDecoder('windows-1251');
                    nameToFormat = decoder.decode(bytes);
                } catch (error) {
                    console.warn('Failed to decode potential Mojibake name:', error);
                }
              }

              const formattedName = formatters.formatPN(nameToFormat);
              return (
                 <div className="overlay-item flex flex-row text-[10px] leading-3 text-white">
                    {formattedName}
                 </div>
              );
            },
          },
          {
            id: 'StudyDate',
            attribute: 'StudyDate',
            label: '',
            contentF: ({ instance }) => {
              if (!instance) return null;
              return (
              <div className="overlay-item flex flex-row text-[10px] leading-3 text-white">
                {instance.StudyDate}
              </div>
            )},
          },
          {
            id: 'SeriesNumber',
            attribute: 'SeriesNumber',
            label: '',
            contentF: ({ instance }) => {
              if (!instance) return null;
              return (
              <div className="overlay-item flex flex-row text-[10px] leading-3">
                <span className="text-[#b0b0b0] mr-1">Series :</span>
                <span className="text-white">{instance.SeriesNumber}</span>
              </div>
            )},
          },
        ],
        'viewportOverlay.topRight': [
          {
            id: 'MPR',
            label: '',
            contentF: () => (
              <div className="overlay-item flex flex-row text-[10px] leading-3 text-white">
                MPR
              </div>
            ),
          },
          {
            id: 'SliceThickness',
            attribute: 'SliceThickness',
            label: '',
            contentF: ({ instance }) => {
              if (!instance) return null;
              return instance.SliceThickness ? (
                <div className="overlay-item flex flex-row text-[10px] leading-3">
                  <span className="text-[#b0b0b0] mr-1">TH :</span>
                  <span className="text-white">
                    {Number(instance.SliceThickness).toFixed(1)}mm
                  </span>
                </div>
              ) : null;
            },
          },
        ],
        'viewportOverlay.bottomLeft': [
          {
            id: 'Dose',
            label: '',
            contentF: ({ instance }) => {
              if (!instance) return null;
              return instance.ImageAndFluoroscopyAreaDoseProduct ? (
                <div className="overlay-item flex flex-row text-[10px] leading-3 text-white">
                  {Number(instance.ImageAndFluoroscopyAreaDoseProduct).toFixed(2)} [dGy*cm^2]
                </div>
              ) : null;
            },
          },
          {
            id: 'mA',
            label: '',
            contentF: ({ instance }) => {
              if (!instance) return null;
              return instance.XRayTubeCurrent ? (
                <div className="overlay-item flex flex-row text-[10px] leading-3 text-white">
                  {Number(instance.XRayTubeCurrent).toFixed(1)} [mA]
                </div>
              ) : null;
            },
          },
          {
            id: 'kVp',
            label: '',
            contentF: ({ instance }) => {
              if (!instance) return null;
              return instance.KVP ? (
                <div className="overlay-item flex flex-row text-[10px] leading-3 text-white">
                  {Number(instance.KVP).toFixed(0)} [kVp]
                </div>
              ) : null;
            },
          },
          {
            id: 'Modality',
            attribute: 'Modality',
            label: '',
            contentF: ({ instance }) => {
               if (!instance) return null;
               return (
               <div className="overlay-item flex flex-row text-[10px] leading-3 text-white">
                  {instance.Modality}
               </div>
            )},
          },
          {
            id: 'BottomSpacer',
            label: '',
            contentF: () => <div className="h-[36px]"></div>,
          },
        ],
        'viewportOverlay.bottomRight': [
          {
            id: 'Scale',
            label: '',
            contentF: ({ viewportId, servicesManager }) => {
              const { cornerstoneViewportService } = servicesManager.services;
              const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
              if (!viewport) return null;

              const camera = viewport.getCamera();
              const { parallelScale } = camera;

              if (!parallelScale) return null;

              const element = viewport.element;
              const pixelsPerMM = element.clientHeight / (2 * parallelScale);
              const height5cm = pixelsPerMM * 50; // 50mm

              if (height5cm <= 0) return null;

              const ticks = [];
              for (let i = 0; i <= 10; i++) {
                ticks.push(
                  <div
                    key={i}
                    className="absolute right-0 bg-[#FFD700]"
                    style={{
                      top: `${(i / 10) * 100}%`,
                      width: i % 2 === 0 ? '8px' : '4px',
                      height: '1px',
                    }}
                  />
                );
              }

              return (
                <div
                  className="flex flex-col items-center absolute right-0"
                  style={{
                    bottom: `${element.clientHeight / 2}px`,
                    transform: 'translateY(50%)'
                  }}
                >
                  <div className="relative border-r border-[#FFD700] w-4 mr-2" style={{ height: `${height5cm}px` }}>
                    {ticks}
                  </div>
                  <div className="text-[10px] leading-3 text-[#FFD700] mt-1 mr-2 text-center w-full">
                    5 cm
                  </div>
                </div>
              );
            },
          },
        ],
      });

      toolbarService.register(toolbarButtons);

      toolbarService.updateSection(toolbarService.sections.primary, [
        'WindowLevel',
        'Pan',
        'Zoom',
        'TrackballRotate',
        'Capture',
        'Layout',
        'Crosshairs',
        'DentalImplant',
        'MoreTools',
      ]);

      toolbarService.clearButtonSection(toolbarService.sections.viewportActionMenu.topLeft);

      toolbarService.updateSection(toolbarService.sections.viewportActionMenu.bottomMiddle, [
        'AdvancedRenderingControls',
      ]);

      toolbarService.updateSection('AdvancedRenderingControls', [
        'windowLevelMenuEmbedded',
        'voiManualControlMenu',
        'Colorbar',
        'opacityMenu',
        'thresholdMenu',
      ]);

      toolbarService.clearButtonSection(toolbarService.sections.viewportActionMenu.topRight);

      // Explicitly remove buttons to ensure they don't persist
      toolbarService.removeButton('modalityLoadBadge');
      toolbarService.removeButton('trackingStatus');
      toolbarService.removeButton('navigationComponent');

      toolbarService.updateSection(toolbarService.sections.viewportActionMenu.bottomLeft, [
        'windowLevelMenu',
      ]);

      toolbarService.updateSection('MoreTools', [
        'Reset',
        'rotate-right',
        'flipHorizontal',
        'ReferenceLines',
        'ImageOverlayViewer',
        'StackScroll',
        'invert',
        'Cine',
        'Magnify',
        'TagBrowser',
      ]);

      toolbarService.updateSection(toolbarService.sections.labelMapSegmentationToolbox, [
        'LabelMapTools',
      ]);
      toolbarService.updateSection(toolbarService.sections.contourSegmentationToolbox, [
        'ContourTools',
      ]);

      toolbarService.updateSection('LabelMapTools', [
        'LabelmapSlicePropagation',
        'BrushTools',
        'MarkerLabelmap',
        'RegionSegmentPlus',
        'Shapes',
        'LabelMapEditWithContour',
      ]);
      toolbarService.updateSection('ContourTools', [
        'PlanarFreehandContourSegmentationTool',
        'SculptorTool',
        'SplineContourSegmentationTool',
        'LivewireContourSegmentationTool',
      ]);

      toolbarService.updateSection(toolbarService.sections.labelMapSegmentationUtilities, [
        'LabelMapUtilities',
      ]);
      toolbarService.updateSection(toolbarService.sections.contourSegmentationUtilities, [
        'ContourUtilities',
      ]);

      toolbarService.updateSection('LabelMapUtilities', [
        'InterpolateLabelmap',
        'SegmentBidirectional',
      ]);
      toolbarService.updateSection('ContourUtilities', [
        'LogicalContourOperations',
        'SimplifyContours',
        'SmoothContours',
      ]);

      toolbarService.updateSection('BrushTools', ['Brush', 'Eraser', 'Threshold']);

      const { unsubscribeAutoTabSwitchEvents } = setUpAutoTabSwitchHandler({
        segmentationService,
        viewportGridService,
        panelService,
      });

      _unsubscriptions.push(...unsubscribeAutoTabSwitchEvents);
    },
    onModeExit: ({ servicesManager }: withAppTypes) => {
      const {
        toolGroupService,
        syncGroupService,
        segmentationService,
        cornerstoneViewportService,
        uiDialogService,
        uiModalService,
      } = servicesManager.services;

      _unsubscriptions.forEach(unsubscribe => unsubscribe());
      _unsubscriptions.length = 0;

      uiDialogService.hideAll();
      uiModalService.hide();
      toolGroupService.destroy();
      syncGroupService.destroy();
      segmentationService.destroy();
      cornerstoneViewportService.destroy();
    },
    /** */
    validationTags: {
      study: [],
      series: [],
    },
    /**
     * A boolean return value that indicates whether the mode is valid for the
     * modalities of the selected studies. Currently we don't have stack viewport
     * segmentations and we should exclude them
     */
    isValidMode: ({ modalities }) => {
      // Don't show the mode if the selected studies have only one modality
      // that is not supported by the mode
      const modalitiesArray = modalities.split('\\');
      return {
        valid:
          modalitiesArray.length === 1
            ? !['SM', 'ECG', 'OT', 'DOC'].includes(modalitiesArray[0])
            : true,
        description:
          'The mode does not support studies that ONLY include the following modalities: SM, OT, DOC',
      };
    },
    /**
     * Mode Routes are used to define the mode's behavior. A list of Mode Route
     * that includes the mode's path and the layout to be used. The layout will
     * include the components that are used in the layout. For instance, if the
     * default layoutTemplate is used (id: '@ohif/extension-default.layoutTemplateModule.viewerLayout')
     * it will include the leftPanels, rightPanels, and viewports. However, if
     * you define another layoutTemplate that includes a Footer for instance,
     * you should provide the Footer component here too. Note: We use Strings
     * to reference the component's ID as they are registered in the internal
     * ExtensionManager. The template for the string is:
     * `${extensionId}.{moduleType}.${componentId}`.
     */
    routes: [
      {
        path: 'template',
        layoutTemplate: ({ location, servicesManager }) => {
          return {
            id: ohif.layout,
            props: {
              leftPanels: [],
              leftPanelResizable: false,
              rightPanels: [],
              rightPanelResizable: false,
              // leftPanelClosed: true,
              viewports: [
                {
                  namespace: cornerstone.viewport,
                  displaySetsToDisplay: [ohif.sopClassHandler],
                },
                {
                  namespace: segmentation.viewport,
                  displaySetsToDisplay: [segmentation.sopClassHandler],
                },
                {
                  namespace: dicomRT.viewport,
                  displaySetsToDisplay: [dicomRT.sopClassHandler],
                },
              ],
            },
          };
        },
      },
    ],
    /** List of extensions that are used by the mode */
    extensions: extensionDependencies,
    /** HangingProtocol used by the mode */
    // Commented out to just use the most applicable registered hanging protocol
    // The example is used for a grid layout to specify that as a preferred layout
    hangingProtocol: ['mpr2x2', 'default'],
    /** SopClassHandlers used by the mode */
    sopClassHandlers: [ohif.sopClassHandler, segmentation.sopClassHandler, dicomRT.sopClassHandler],
  };
}

const mode = {
  id,
  modeFactory,
  extensionDependencies,
};

export default mode;
