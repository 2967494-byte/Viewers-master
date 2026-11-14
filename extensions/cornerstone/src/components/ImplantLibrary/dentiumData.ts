import type { ImplantFamily, ImplantManufacturer } from './implantData';

// Manufacturer-authored catalogues; page numbers are PDF pages, not printed folios.
export const DENTIUM_SOURCES = {
  simpleLine: 'https://www.dentium.co.kr/admin/bbs/down.php?code=dtIFU05&idx=6274&no=1#page=8',
  simpleLineHeights:
    'https://www.minimaximplant.com.au/wp-content/uploads/2022/11/Simple_Line_ll_2023.pdf',
  boneLevel:
    'https://cdn.prod.website-files.com/60a29e82f743b4ecd2684aeb/64ffc23898c0373302a4e1a5_catalog_web.pdf',
  nrLine:
    'https://cdn.prod.website-files.com/60a29e82f743b4ecd2684aeb/633c6be16300cde06a8da385_pn2999-1-nr-line-catalog.pdf#page=5',
};
export const DENTIUM_CATALOG_CHECKED_AT = '2026-11-14';

type Variant = {
  body: number;
  platform: number;
  lengths: number[];
  prefix: string;
  suffix: string;
  gingivalHeight?: number;
  variantLabel?: string;
  sourceUrl?: string;
};

function family(name: string, sourceUrl: string, variants: Variant[]): ImplantFamily {
  return {
    name,
    sourceUrl,
    models: variants.flatMap(variant =>
      variant.lengths.map(length => {
        const catalogNumber = `${variant.prefix}${String(length).padStart(2, '0')}${variant.suffix}`;
        return {
          id: catalogNumber,
          catalogNumber,
          name: `${name} Ø ${variant.body} × ${length} мм · платф. Ø ${variant.platform}${
            variant.gingivalHeight ? ` · G/H ${variant.gingivalHeight}` : ''
          }${variant.variantLabel ? ` · ${variant.variantLabel}` : ''}`,
          manufacturer: 'Dentium',
          family: name,
          dimensions: { diameter: variant.body, length },
          platformDiameter: variant.platform,
          gingivalHeight: variant.gingivalHeight,
          variantLabel: variant.variantLabel,
          sourceUrl: variant.sourceUrl || sourceUrl,
          color: '#c084fc',
          geometry: 'nominal-cylinder' as const,
        };
      })
    ),
  };
}

const simplePlatforms = [
  { platform: 4.8, body: 3.4, prefix: 'SOFX4834' },
  { platform: 4.8, body: 3.8, prefix: 'SOFX4838' },
  { platform: 4.8, body: 4.3, prefix: 'SOFX4843' },
  { platform: 6.5, body: 4.3, prefix: 'SOFX6543' },
  { platform: 6.5, body: 4.8, prefix: 'SOFX6548' },
];
const bonePlatforms = [
  { platform: 3.6, body: 3.4, code: '36' },
  { platform: 4, body: 3.8, code: '40' },
  { platform: 4.5, body: 4.3, code: '45' },
  { platform: 5, body: 4.8, code: '50' },
  { platform: 6, body: 4.8, code: '60' },
  { platform: 7, body: 5.8, code: '70' },
];

export const DENTIUM_DATA: ImplantManufacturer = {
  manufacturer: 'Dentium',
  lines: [
    family('SimpleLine II', DENTIUM_SOURCES.simpleLine, [
      // G/H 1.6: the manufacturer's table has NO body Ø3.4 entry.
      ...simplePlatforms
        .filter(item => item.body !== 3.4)
        .map(item => ({
          ...item,
          lengths: [8, 10, 12],
          suffix: 'S',
          gingivalHeight: 1.6,
          sourceUrl: `${DENTIUM_SOURCES.simpleLineHeights}#page=9`,
        })),
      ...simplePlatforms.map(item => ({
        ...item,
        lengths: [8, 10, 12],
        suffix: '',
        gingivalHeight: 2,
      })),
      ...simplePlatforms.map(item => ({
        ...item,
        lengths: [8, 10, 12],
        suffix: 'R',
        gingivalHeight: 2.2,
        sourceUrl: `${DENTIUM_SOURCES.simpleLineHeights}#page=11`,
      })),
    ]),
    family('SuperLine II', `${DENTIUM_SOURCES.boneLevel}#page=10`, [
      // Ø3.6/4.0 short fixtures are BC only; Ø4.5/5.0 have both C and BC.
      ...[
        { platform: 3.6, body: 3.6, code: '36' },
        { platform: 4, body: 4, code: '40' },
        { platform: 4.5, body: 4.5, code: '45' },
        { platform: 5, body: 5, code: '50' },
      ].flatMap(item => {
        const common = {
          ...item,
          prefix: `FXS${item.code}`,
          sourceUrl: `${DENTIUM_SOURCES.boneLevel}#page=${item.platform === 5 ? 11 : 10}`,
        };
        return [
          { ...common, lengths: [8, 10, 12, 14], suffix: 'C' },
          { ...common, lengths: [7], suffix: 'BC', variantLabel: 'BC' },
          ...(item.platform >= 4.5 ? [{ ...common, lengths: [7], suffix: 'C' }] : []),
        ];
      }),
      ...[
        { platform: 6, body: 5, code: '60' },
        { platform: 7, body: 5.8, code: '70' },
      ].map(item => ({
        ...item,
        prefix: `FXS${item.code}`,
        lengths: [7, 8, 10, 12],
        suffix: 'C',
        sourceUrl: `${DENTIUM_SOURCES.boneLevel}#page=11`,
      })),
    ]),
    family(
      'SuperLine',
      `${DENTIUM_SOURCES.boneLevel}#page=16`,
      bonePlatforms.map(item => ({
        ...item,
        prefix: `FX${item.code}`,
        lengths: item.platform >= 6 ? [8, 10, 12] : [8, 10, 12, 14],
        suffix: 'SWC',
        sourceUrl: `${DENTIUM_SOURCES.boneLevel}#page=${item.platform >= 5 ? 17 : 16}`,
      }))
    ),
    family(
      'Implantium',
      `${DENTIUM_SOURCES.boneLevel}#page=22`,
      bonePlatforms.slice(0, 4).map(item => ({
        ...item,
        prefix: `FX${Math.round(item.body * 10)}`,
        lengths: [8, 10, 12, 14],
        suffix: 'MLC',
        sourceUrl: `${DENTIUM_SOURCES.boneLevel}#page=${item.platform === 5 ? 23 : 22}`,
      }))
    ),
    family('NR Line', DENTIUM_SOURCES.nrLine, [
      { body: 3.1, platform: 3.2, prefix: 'GFX30', suffix: 'S', lengths: [9, 11, 13] },
      { body: 3.1, platform: 3.6, prefix: 'GFX30', suffix: '', lengths: [9, 11, 13] },
    ]),
  ],
};
