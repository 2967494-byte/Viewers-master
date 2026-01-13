import { Types } from '@ohif/core';

export const VOI_SYNC_GROUP = {
  type: 'voi',
  id: 'mpr',
  source: true,
  target: true,
  options: {
    syncColormap: true,
  },
};

export const HYDRATE_SEG_SYNC_GROUP = {
  type: 'hydrateseg',
  id: 'sameFORId',
  source: true,
  target: true,
  options: {
    matchingRules: ['sameFOR'],
  },
};

export const mpr2x2: Types.HangingProtocol.Protocol = {
  id: 'mpr2x2',
  name: 'MPR 2x2',
  locked: true,
  icon: 'layout-advanced-mpr',
  isPreset: true,
  createdDate: '2024-03-24',
  modifiedDate: '2024-03-24',
  availableTo: {},
  editableBy: {},
  numberOfPriorsReferenced: 0,
  protocolMatchingRules: [
    {
      id: 'Any-reconstructable',
      weight: 1,
      attribute: 'ModalitiesInStudy',
      constraint: {
        contains: ['CT', 'MR', 'PT'],
      },
    },
  ],
  imageLoadStrategy: 'nth',
  callbacks: {},
  displaySetSelectors: {
    activeDisplaySet: {
      seriesMatchingRules: [
        {
          weight: 1,
          attribute: 'isReconstructable',
          constraint: {
            equals: {
              value: true,
            },
          },
          required: true,
        },
      ],
    },
  },
  stages: [
    {
      name: 'MPR 2x2',
      viewportStructure: {
        layoutType: 'grid',
        properties: {
          rows: 2,
          columns: 2,
        },
      },
      viewports: [
        // Row 1
        {
          viewportOptions: {
            viewportId: 'mpr-coronal',
            toolGroupId: 'mpr',
            viewportType: 'volume',
            orientation: 'coronal',
            initialImageOptions: {
              preset: 'middle',
            },
            syncGroups: [VOI_SYNC_GROUP, HYDRATE_SEG_SYNC_GROUP],
          },
          displaySets: [
            {
              id: 'activeDisplaySet',
            },
          ],
        },
        {
          viewportOptions: {
            viewportId: 'mpr-sagittal',
            toolGroupId: 'mpr',
            viewportType: 'volume',
            orientation: 'sagittal',
            initialImageOptions: {
              preset: 'middle',
            },
            syncGroups: [VOI_SYNC_GROUP, HYDRATE_SEG_SYNC_GROUP],
          },
          displaySets: [
            {
              id: 'activeDisplaySet',
            },
          ],
        },
        // Row 2
        {
          viewportOptions: {
            viewportId: 'mpr-axial',
            toolGroupId: 'mpr',
            viewportType: 'volume',
            orientation: 'axial',
            initialImageOptions: {
              preset: 'middle',
            },
            syncGroups: [VOI_SYNC_GROUP, HYDRATE_SEG_SYNC_GROUP],
          },
          displaySets: [
            {
              id: 'activeDisplaySet',
            },
          ],
        },
        // 3D Viewport
        {
          viewportOptions: {
            viewportId: 'mpr-3d',
            toolGroupId: 'mpr-3d',
            viewportType: 'volume3d',
            orientation: 'coronal',
            initialImageOptions: {
                // preset: 'middle',
            },
            syncGroups: [VOI_SYNC_GROUP],
            customViewportProps: {
              hideOverlays: true,
            }
          },
          displaySets: [
            {
              id: 'activeDisplaySet',
               options: {
                 blendMode: 'MIP',
               }
            },
          ],
        },
      ],
    },
  ],
};
