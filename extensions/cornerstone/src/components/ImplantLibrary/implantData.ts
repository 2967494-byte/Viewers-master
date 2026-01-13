export const IMPLANT_DATA = [
  {
    manufacturer: 'Straumann',
    lines: [
      {
        name: 'Bone Level Tapered (BLT)',
        models: [
          {
            id: 'BLT-3.3-8',
            name: 'BLT Ø 3.3mm - 8mm',
            dimensions: { length: 8, diameter: 3.3 },
            color: '#FFFF00', // Yellow
          },
          {
            id: 'BLT-3.3-10',
            name: 'BLT Ø 3.3mm - 10mm',
            dimensions: { length: 10, diameter: 3.3 },
            color: '#FFFF00',
          },
          {
            id: 'BLT-4.1-10',
            name: 'BLT Ø 4.1mm - 10mm',
            dimensions: { length: 10, diameter: 4.1 },
            color: '#FF0000', // Red
          },
          {
            id: 'BLT-4.8-12',
            name: 'BLT Ø 4.8mm - 12mm',
            dimensions: { length: 12, diameter: 4.8 },
            color: '#0000FF', // Blue
          },
        ],
      },
      {
        name: 'Tissue Level (TL)',
        models: [
          {
            id: 'TL-4.8-10',
            name: 'TL Ø 4.8mm - 10mm',
            dimensions: { length: 10, diameter: 4.8 },
            color: '#00FF00', // Green
          },
        ],
      },
    ],
  },
  {
    manufacturer: 'Nobel Biocare',
    lines: [
      {
        name: 'NobelActive',
        models: [
          {
            id: 'NA-3.5-10',
            name: 'NobelActive 3.5 x 10mm',
            dimensions: { length: 10, diameter: 3.5 },
            color: '#FF00FF', // Magenta
          },
          {
            id: 'NA-4.3-11.5',
            name: 'NobelActive 4.3 x 11.5mm',
            dimensions: { length: 11.5, diameter: 4.3 },
            color: '#00FFFF', // Cyan
          },
        ],
      },
    ],
  },
  {
    manufacturer: 'Osstem',
    lines: [
      {
        name: 'TS III SA',
        models: [
          {
            id: 'TS3-4.0-10',
            name: 'TS III Ø 4.0 x 10mm',
            dimensions: { length: 10, diameter: 4.0 },
            color: '#FFA500', // Orange
          },
        ],
      },
    ],
  },
];
