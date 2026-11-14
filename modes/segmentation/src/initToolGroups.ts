import { MIN_SEGMENTATION_DRAWING_RADIUS, MAX_SEGMENTATION_DRAWING_RADIUS } from './constants';
import { ORBITAL_MPR_COLORS } from '@ohif/core/src/constants/orbitalTheme';

const colours = {
  'viewport-0': ORBITAL_MPR_COLORS.axial,
  'viewport-1': ORBITAL_MPR_COLORS.sagittal,
  'viewport-2': ORBITAL_MPR_COLORS.coronal,
};

const colorsByOrientation = ORBITAL_MPR_COLORS;

function createTools({ utilityModule, commandsManager }) {
  const { Enums } = utilityModule.exports;

  const tools = {
    active: [
      { toolName: 'WindowLevel', bindings: [{ mouseButton: Enums.MouseBindings.Primary }] },
      { toolName: 'Pan', bindings: [{ mouseButton: Enums.MouseBindings.Auxiliary }] },
      {
        toolName: 'Zoom',
        bindings: [{ mouseButton: Enums.MouseBindings.Secondary }, { numTouchPoints: 2 }],
      },
      {
        toolName: 'StackScroll',
        bindings: [{ mouseButton: Enums.MouseBindings.Wheel }, { numTouchPoints: 3 }],
      },
    ],
    passive: [
      /*
      {
        toolName: 'CircularBrush',
        parentTool: 'Brush',
        configuration: {
          activeStrategy: 'FILL_INSIDE_CIRCLE',
          minRadius: MIN_SEGMENTATION_DRAWING_RADIUS,
          maxRadius: MAX_SEGMENTATION_DRAWING_RADIUS,
        },
      },
      */
      {
        toolName: 'LabelmapSlicePropagation',
      },
      {
        toolName: 'MarkerLabelmap',
      },
      {
        toolName: 'RegionSegmentPlus',
      },
      /*
      {
        toolName: 'CircularEraser',
        parentTool: 'Brush',
        configuration: {
          activeStrategy: 'ERASE_INSIDE_CIRCLE',
          minRadius: MIN_SEGMENTATION_DRAWING_RADIUS,
          maxRadius: MAX_SEGMENTATION_DRAWING_RADIUS,
        },
      },
      {
        toolName: 'SphereBrush',
        parentTool: 'Brush',
        configuration: {
          activeStrategy: 'FILL_INSIDE_SPHERE',
          minRadius: MIN_SEGMENTATION_DRAWING_RADIUS,
          maxRadius: MAX_SEGMENTATION_DRAWING_RADIUS,
        },
      },
      {
        toolName: 'SphereEraser',
        parentTool: 'Brush',
        configuration: {
          activeStrategy: 'ERASE_INSIDE_SPHERE',
          minRadius: MIN_SEGMENTATION_DRAWING_RADIUS,
          maxRadius: MAX_SEGMENTATION_DRAWING_RADIUS,
        },
      },
      {
        toolName: 'ThresholdCircularBrush',
        parentTool: 'Brush',
        configuration: {
          activeStrategy: 'THRESHOLD_INSIDE_CIRCLE',
          minRadius: MIN_SEGMENTATION_DRAWING_RADIUS,
          maxRadius: MAX_SEGMENTATION_DRAWING_RADIUS,
        },
      },
      {
        toolName: 'ThresholdSphereBrush',
        parentTool: 'Brush',
        configuration: {
          activeStrategy: 'THRESHOLD_INSIDE_SPHERE',
          minRadius: MIN_SEGMENTATION_DRAWING_RADIUS,
          maxRadius: MAX_SEGMENTATION_DRAWING_RADIUS,
        },
      },
      {
        toolName: 'ThresholdCircularBrushDynamic',
        parentTool: 'Brush',
        configuration: {
          activeStrategy: 'THRESHOLD_INSIDE_CIRCLE',
          minRadius: MIN_SEGMENTATION_DRAWING_RADIUS,
          maxRadius: MAX_SEGMENTATION_DRAWING_RADIUS,
          threshold: {
            isDynamic: true,
            dynamicRadius: 3,
          },
        },
      },
      */

      // {
      //   toolName: toolNames.OrientationMarker,
      //   configuration: {
      //     orientationWidget: {
      //       viewportCorner: 'bottom-right',
      //     },
      //   },
      // },
      {
        toolName: 'ReferenceLines',
        configuration: {
          sourceViewportId: '',
        },
      },
      {
        toolName: 'SegmentBidirectional',
      },
      /*
      {
        toolName: 'SegmentSelect',
      },
      {
        toolName: 'ThresholdSphereBrushDynamic',
        parentTool: 'Brush',
        configuration: {
          activeStrategy: 'THRESHOLD_INSIDE_SPHERE',
          minRadius: MIN_SEGMENTATION_DRAWING_RADIUS,
          maxRadius: MAX_SEGMENTATION_DRAWING_RADIUS,
          threshold: {
            isDynamic: true,
            dynamicRadius: 3,
          },
        },
      },
      {
        toolName: 'LabelMapEditWithContourTool',
      },
      { toolName: 'CircleScissors' },
      { toolName: 'RectangleScissors' },
      { toolName: 'SphereScissors' },
      */
      { toolName: 'StackScroll' },
      { toolName: 'Magnify' },
      { toolName: 'DentalMagnify' },
      { toolName: 'WindowLevelRegion' },

      /*
      { toolName: 'UltrasoundDirectional' },
      */
      /*
      {
        toolName: 'DentalImplant',
      },
      {
        toolName: 'PlanarFreehandContourSegmentation',
      },
      { toolName: 'LivewireContourSegmentation' },
      { toolName: 'SculptorTool' },
      { toolName: 'PlanarFreehandROI' },
      */
      /*
      {
        toolName: 'CatmullRomSplineROI',
        parentTool: 'SplineContourSegmentation',
        configuration: {
          spline: {
            type: 'CATMULLROM',
            enableTwoPointPreview: true,
          },
        },
      },
      {
        toolName: 'LinearSplineROI',
        parentTool: 'SplineContourSegmentation',
        configuration: {
          spline: {
            type: 'LINEAR',
            enableTwoPointPreview: true,
          },
        },
      },
      {
        toolName: 'BSplineROI',
        parentTool: 'SplineContourSegmentation',
        configuration: {
          spline: {
            type: 'BSPLINE',
            enableTwoPointPreview: true,
          },
        },
      },
      */
    ],
    enabled: [
      { toolName: 'ImageOverlayViewer' },
      /*
      {
        toolName: toolNames.ScaleOverlay,
        configuration: {
          location: 'top-right',
          scaleSize: 100, // Optional: adjust size if needed
        },
      },
      */
      /*
      { toolName: 'CenterCross' },
      */
      { toolName: 'VerticalScaleOverlay' },
      // FocalPointCross removed - dot is now drawn by VerticalScaleOverlay
    ],
    disabled: [{ toolName: 'ReferenceLines' }, { toolName: 'AdvancedMagnify' }],
  };

  const updatedTools = commandsManager.run('initializeSegmentLabelTool', { tools });

  return updatedTools;
}

function initDefaultToolGroup(extensionManager, toolGroupService, commandsManager, toolGroupId) {
  const utilityModule = extensionManager.getModuleEntry(
    '@ohif/extension-cornerstone.utilityModule.tools'
  );
  const tools = createTools({ commandsManager, utilityModule });
  toolGroupService.createToolGroupAndAddTools(toolGroupId, tools);
}

function initMPRToolGroup(extensionManager, toolGroupService, commandsManager) {
  const utilityModule = extensionManager.getModuleEntry(
    '@ohif/extension-cornerstone.utilityModule.tools'
  );
  const servicesManager = extensionManager._servicesManager;
  const { cornerstoneViewportService } = servicesManager.services;
  const { Enums } = utilityModule.exports;
  const tools = createTools({ commandsManager, utilityModule });

  // Remove WindowLevel from active tools to replace with Crosshairs
  tools.active = tools.active.filter(tool => tool.toolName !== 'WindowLevel');
  tools.passive.push({ toolName: 'DentalImplant' });

  tools.active.push(
    {
      toolName: 'Crosshairs',
      bindings: [{ mouseButton: Enums.MouseBindings.Primary }],
      configuration: {
        viewportIndicators: false,
        handleRadius: 8,
        explainHandles: true,
        // Thin crosshair lines
        lineWidth: 1,
        // No gap in center - lines meet at intersection point
        centerGapRatio: 0,
        viewportIndicatorsConfig: {
          circleRadius: 5,
          xOffset: 0.95,
          yOffset: 0.05,
        },
        autoPan: {
          enabled: false,
          panSize: 5,
        },
        getReferenceLineColor: viewportId => {
          const viewportInfo = cornerstoneViewportService.getViewportInfo(viewportId);
          const viewportOptions = viewportInfo?.viewportOptions;
          if (viewportOptions) {
            return (
              colours[viewportOptions.id] ||
              colorsByOrientation[viewportOptions.orientation] ||
              ORBITAL_MPR_COLORS.axial
            );
          } else {
            console.warn('missing viewport?', viewportId);
            return ORBITAL_MPR_COLORS.axial;
          }
        },
      },
    }
  );

  tools.active.push({
    toolName: 'VerticalScaleOverlay',
    bindings: [],
  });

  // Focal point dot is now drawn by VerticalScaleOverlayTool directly

  tools.passive.push(
    ...['Length', 'Angle', 'DentalLength2D', 'DentalLength3D', 'DentalAngle3D', 'DentalTapeLine', 'DentalTapeCurve', 'DentalCanal']
      .map(toolName => ({ toolName })),
    { toolName: 'ReferenceLines' }
  );
  toolGroupService.createToolGroupAndAddTools('mpr', tools);
}

function initVolume3DToolGroup(extensionManager, toolGroupService) {
  const utilityModule = extensionManager.getModuleEntry(
    '@ohif/extension-cornerstone.utilityModule.tools'
  );

  const { Enums } = utilityModule.exports;

  const tools = {
    active: [
      {
        toolName: 'VolumeRotateMouseWheel',
        bindings: [{ mouseButton: Enums.MouseBindings.Wheel }],
      },
      {
        toolName: 'TrackballRotate',
        bindings: [{ mouseButton: Enums.MouseBindings.Primary }],
      },
      {
        toolName: 'Zoom',
        bindings: [{ mouseButton: Enums.MouseBindings.Secondary }, { numTouchPoints: 2 }],
      },
      {
        toolName: 'Pan',
        bindings: [{ mouseButton: Enums.MouseBindings.Auxiliary }],
      },
    ],
    enabled: [
      {
        toolName: 'OrientationMarker',
      },
      {
        toolName: 'Crosshairs',
        configuration: {
          viewportIndicators: true,
          autoPan: {
            enabled: false,
          },
          getReferenceLineColor: (viewportId) => {
             return Object.entries(ORBITAL_MPR_COLORS)
               .find(([orientation]) => viewportId.includes(orientation))?.[1]
               || ORBITAL_MPR_COLORS.axial;
          },
        },
      },
    ],
    passive: [
      { toolName: 'DentalMagnify' },
      ...['DentalLength2D', 'DentalLength3D', 'DentalAngle3D', 'DentalTapeLine', 'DentalTapeCurve', 'DentalCanal']
        .map(toolName => ({ toolName })),
      {
        toolName: 'DentalImplant',
      },
    ],
  };

  toolGroupService.createToolGroupAndAddTools('mpr-3d', tools);
}

function initToolGroups(extensionManager, toolGroupService, commandsManager) {
  initDefaultToolGroup(extensionManager, toolGroupService, commandsManager, 'default');
  initMPRToolGroup(extensionManager, toolGroupService, commandsManager);
  initVolume3DToolGroup(extensionManager, toolGroupService);
}

export default initToolGroups;
