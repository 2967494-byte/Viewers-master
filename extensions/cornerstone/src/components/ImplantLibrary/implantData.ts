/** Catalog dimensions only. Geometry is an explicitly schematic cylinder, not manufacturer CAD. */
export type ImplantModel = {
  id: string;
  name: string;
  dimensions: { length: number; diameter: number };
  color: string;
  manufacturer: string;
  family: string;
  sourceUrl: string;
  geometry: 'nominal-cylinder';
};
export type ImplantFamily = { name: string; sourceUrl: string; models: ImplantModel[] };
export type ImplantManufacturer = { manufacturer: string; lines: ImplantFamily[] };
type Matrix = [diameter: number, lengths: number[]][];

const SOURCES = {
  straumann:
    'https://www.straumann.com/content/dam/media-center/straumann/en-us/documents/brochure/product-catalog/USLIT-007-Product-Catalog-2021-DIGITAL.pdf',
  iexcel:
    'https://www.straumann.com/content/dam/media-center/straumann/en/documents/brochure/technical-information/450.036-en_low.pdf',
  nobelCC:
    'https://www.nobelbiocare.com/en-int/system/files/gmt_import/CC%20Implants%20product%20overview%202024.1%20GB_89102.pdf',
  nobelTapered:
    'https://www.nobelbiocare.com/en-ca/system/files/gmt_import/NobelReplace%20and%20Replace%20Select%20Tapered%20manual%20USA_75434%20D.pdf',
  nobelShift: 'https://store.nobelbiocare.com/us/en/media/eifu/IFU1011_EN_US_00.pdf',
  n1: 'https://www.nobelbiocare.com/es-es/system/files/gmt_import/N1%20System%20Product%20Overview_ES_87730.pdf',
  osstem: 'https://osstem.si/images/pdf/TS_en-0329P.125549.pdf',
  osstemNarrow: 'https://www.osstem.ru/workdir/articles/00/ts-iii-30-a4-listovka.pdf',
  osstemSS: 'https://www.osstem.ru/workdir/articles/00/ss-katalog-noyabr-2020-web.pdf',
};

// Explicit per-diameter lists: unavailable diameter/length combinations are never generated.
const line = (
  manufacturer: string,
  name: string,
  prefix: string,
  matrix: Matrix,
  sourceUrl: string
): ImplantFamily => ({
  name,
  sourceUrl,
  models: matrix.flatMap(([diameter, lengths]) =>
    lengths.map(length => ({
      // Preserve identifiers already used by the original eight library entries.
      id: `${prefix}-${prefix === 'TS3' ? diameter.toFixed(1) : diameter}-${length}`,
      name: `${name} Ø ${diameter} × ${length} мм`,
      dimensions: { length, diameter },
      manufacturer,
      family: name,
      sourceUrl,
      geometry: 'nominal-cylinder' as const,
      color:
        manufacturer === 'Straumann'
          ? '#fbbf24'
          : manufacturer === 'Nobel Biocare'
            ? '#67e8f9'
            : '#fb923c',
    }))
  ),
});
const regular = [6, 8, 10, 12, 14, 16, 18];
const wide = [6, 8, 10, 12, 14, 16];
const osstemRegular = [7, 8.5, 10, 11.5, 13];
const osstemWide = [6, 7, 8.5, 10, 11.5, 13];
const taperedLengths = [8, 10, 11.5, 13, 16];

export const IMPLANT_DATA: ImplantManufacturer[] = [
  {
    manufacturer: 'Straumann',
    lines: [
      line(
        'Straumann',
        'Bone Level Tapered (BLT)',
        'BLT',
        [
          [2.9, [10, 12, 14]],
          [3.3, [8, 10, 12, 14, 16, 18]],
          [4.1, [8, 10, 12, 14, 16, 18]],
          [4.8, [8, 10, 12, 14, 16, 18]],
        ],
        SOURCES.straumann + '#page=13'
      ),
      line(
        'Straumann',
        'Tissue Level (TL) · Standard Plus',
        'TL',
        [
          [3.3, [8, 10, 12, 14]],
          [4.1, [4, 6, 8, 10, 12, 14]],
          [4.8, [4, 6, 8, 10, 12, 14]],
        ],
        SOURCES.straumann + '#page=19'
      ),
      line(
        'Straumann',
        'Tissue Level · Standard',
        'TLS',
        [
          [3.3, [8, 10, 12, 14, 16]],
          [4.1, [6, 8, 10, 12, 14, 16]],
          [4.8, [6, 8, 10, 12, 14]],
        ],
        SOURCES.straumann + '#page=19'
      ),
      line(
        'Straumann',
        'Bone Level (BL)',
        'BL',
        [
          [3.3, [8, 10, 12, 14]],
          [4.1, [8, 10, 12, 14]],
          [4.8, [8, 10, 12, 14]],
        ],
        SOURCES.straumann + '#page=13'
      ),
      line(
        'Straumann',
        'BLX',
        'BLX',
        [
          [3.5, [8, 10, 12, 14, 16, 18]],
          [3.75, regular],
          [4, regular],
          [4.5, regular],
          [5, regular],
          [5.5, wide],
          [6.5, wide],
        ],
        SOURCES.iexcel + '#page=6'
      ),
      line(
        'Straumann',
        'BLC',
        'BLC',
        [
          [3.3, [8, 10, 12, 14, 16, 18]],
          [3.75, regular],
          [4, regular],
          [4.5, regular],
          [5, regular],
          [5.5, wide],
          [6.5, wide],
        ],
        SOURCES.iexcel + '#page=5'
      ),
      line(
        'Straumann',
        'TLX · Standard Plus',
        'TLX-SP',
        [
          [3.75, regular],
          [4, [4]],
          [4.5, [4, ...regular]],
          [5, [4]],
          [5.5, [6, 8, 10, 12]],
          [6.5, [6, 8, 10, 12]],
        ],
        SOURCES.iexcel + '#page=11'
      ),
      line(
        'Straumann',
        'TLX · Standard',
        'TLX-S',
        [
          [3.75, regular],
          [4.5, regular],
          [5.5, [6, 8, 10, 12]],
          [6.5, [6, 8, 10, 12]],
        ],
        SOURCES.iexcel + '#page=12'
      ),
      line(
        'Straumann',
        'TLC · Standard Plus',
        'TLC-SP',
        [
          [3.3, [8, 10, 12, 14, 16, 18]],
          [3.75, regular],
          [4.5, regular],
          [5.5, wide],
          [6.5, wide],
        ],
        SOURCES.iexcel + '#page=9'
      ),
      line(
        'Straumann',
        'TLC · Standard',
        'TLC-S',
        [
          [3.3, [8, 10, 12]],
          [3.75, [6, 8, 10, 12]],
          [4.5, [6, 8, 10, 12]],
          [5.5, [6, 8, 10, 12]],
          [6.5, [6, 8, 10, 12]],
        ],
        SOURCES.iexcel + '#page=10'
      ),
      line(
        'Straumann',
        'PURE Ceramic Monotype',
        'PURE-M',
        [
          [3.3, [8, 10, 12, 14]],
          [4.1, [8, 10, 12, 14]],
        ],
        SOURCES.straumann + '#page=45'
      ),
      line(
        'Straumann',
        'RidgeFit',
        'RIDGEFIT',
        [[2.4, [10, 12, 14]]],
        SOURCES.straumann + '#page=29'
      ),
    ],
  },
  {
    manufacturer: 'Nobel Biocare',
    lines: [
      line(
        'Nobel Biocare',
        'NobelActive',
        'NA',
        [
          [3, [10, 11.5, 13, 15]],
          [3.5, [8.5, 10, 11.5, 13, 15, 18]],
          [4.3, [8.5, 10, 11.5, 13, 15, 18]],
          [5, [8.5, 10, 11.5, 13, 15, 18]],
          [5.5, [7, 8.5, 10, 11.5, 13, 15]],
        ],
        SOURCES.nobelCC
      ),
      line(
        'Nobel Biocare',
        'NobelParallel Conical Connection',
        'NPCC',
        [
          [3.75, [7, 8.5, 10, 11.5, 13, 15, 18]],
          [4.3, [7, 8.5, 10, 11.5, 13, 15, 18]],
          [5, [7, 8.5, 10, 11.5, 13, 15, 18]],
          [5.5, [7, 8.5, 10, 11.5, 13, 15]],
        ],
        SOURCES.nobelCC
      ),
      line(
        'Nobel Biocare',
        'NobelReplace Conical Connection',
        'NRCC',
        [
          [3.5, taperedLengths],
          [4.3, taperedLengths],
          [5, taperedLengths],
        ],
        SOURCES.nobelCC
      ),
      line(
        'Nobel Biocare',
        'Nobel Biocare N1 TiUltra TCC',
        'N1',
        [
          [3.5, [9, 11, 13, 15]],
          [4, [7, 9, 11, 13, 15]],
          [4.8, [7, 9, 11, 13, 15]],
        ],
        SOURCES.n1
      ),
      line(
        'Nobel Biocare',
        'NobelReplace Tapered',
        'NRT',
        [
          [3.5, taperedLengths],
          [4.3, taperedLengths],
          [5, taperedLengths],
          [6, taperedLengths],
        ],
        SOURCES.nobelTapered
      ),
      line(
        'Nobel Biocare',
        'Replace Select Tapered',
        'RST',
        [
          [3.5, taperedLengths],
          [4.3, taperedLengths],
          [5, taperedLengths],
          [6, [8, 10, 11.5, 13]],
        ],
        SOURCES.nobelTapered
      ),
      line(
        'Nobel Biocare',
        'NobelReplace Platform Shift',
        'NRPS',
        [
          [4.3, taperedLengths],
          [5, taperedLengths],
          [6, taperedLengths],
        ],
        SOURCES.nobelShift
      ),
    ],
  },
  {
    manufacturer: 'Osstem',
    lines: [
      line(
        'Osstem',
        'TS III SA',
        'TS3',
        [
          [3.5, [8.5, 10, 11.5, 13]],
          [4, osstemRegular],
          [4.5, osstemRegular],
          [5, osstemWide],
        ],
        SOURCES.osstem + '#page=12'
      ),
      line(
        'Osstem',
        'TS III SA · Ø 3.0',
        'TS3-N',
        [[3, [8.5, 10, 11.5, 13]]],
        SOURCES.osstemNarrow
      ),
      line(
        'Osstem',
        'TS III SA · Ultra-Wide',
        'TS3-UW',
        [
          [6, osstemWide],
          [7, osstemWide],
        ],
        SOURCES.osstem + '#page=13'
      ),
      line(
        'Osstem',
        'TS II SA',
        'TS2',
        [
          [3.5, [8.5, 10, 11.5, 13]],
          [4, osstemRegular],
          [4.5, osstemRegular],
          [5, osstemWide],
        ],
        SOURCES.osstem + '#page=11'
      ),
      line(
        'Osstem',
        'TS IV SA',
        'TS4',
        [
          [4, osstemRegular],
          [4.5, osstemRegular],
          [5, osstemRegular],
        ],
        SOURCES.osstem + '#page=14'
      ),
      line(
        'Osstem',
        'TS IV SA · Ultra-Wide',
        'TS4-UW',
        [
          [6, osstemRegular],
          [7, osstemRegular],
        ],
        SOURCES.osstem + '#page=15'
      ),
      line(
        'Osstem',
        'SS III SA · Standard',
        'SS3',
        [
          [3.5, [8.5, 10, 11.5, 13]],
          [4, osstemRegular],
          [4.5, osstemRegular],
        ],
        SOURCES.osstemSS + '#page=3'
      ),
      line(
        'Osstem',
        'SS III SA · Wide',
        'SS3-W',
        [
          [5, osstemWide],
          [6, osstemWide],
          [7, osstemWide],
        ],
        SOURCES.osstemSS + '#page=4'
      ),
    ],
  },
];

export const IMPLANT_CATALOG_CHECKED_AT = '2026-10-25';
export const IMPLANT_MODEL_COUNT = IMPLANT_DATA.reduce(
  (sum, brand) => sum + brand.lines.reduce((count, family) => count + family.models.length, 0),
  0
);
