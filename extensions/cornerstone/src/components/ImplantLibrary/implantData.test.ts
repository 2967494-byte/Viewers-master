import { IMPLANT_DATA, IMPLANT_MODEL_COUNT } from './implantData';

describe('Sourced implant dimension library', () => {
  const models = IMPLANT_DATA.flatMap(brand => brand.lines.flatMap(line => line.models));
  it('preserves the original eight identifiers and expands all three existing manufacturers', () => {
    const ids = new Set(models.map(model => model.id));
    for (const id of [
      'BLT-3.3-8',
      'BLT-3.3-10',
      'BLT-4.1-10',
      'BLT-4.8-12',
      'TL-4.8-10',
      'NA-3.5-10',
      'NA-4.3-11.5',
      'TS3-4.0-10',
    ])
      expect(ids.has(id)).toBe(true);
    expect(ids.size).toBe(models.length);
    expect(IMPLANT_MODEL_COUNT).toBe(models.length);
    expect(models.length).toBeGreaterThan(450);
    expect(IMPLANT_DATA.map(item => item.manufacturer)).toEqual([
      'Straumann',
      'Nobel Biocare',
      'Osstem',
    ]);
  });
  it('contains only positive dimensions with manufacturer sources and explicit schematic geometry', () => {
    for (const model of models) {
      expect(model.dimensions.length).toBeGreaterThan(0);
      expect(model.dimensions.diameter).toBeGreaterThan(0);
      expect(model.sourceUrl.startsWith('https://')).toBe(true);
      expect(model.geometry).toBe('nominal-cylinder');
    }
  });
  it('does not invent unsupported combinations from a Cartesian product', () => {
    const ids = new Set(models.map(model => model.id));
    expect(ids.has('BLT-2.9-8')).toBe(false);
    expect(ids.has('NA-3-8.5')).toBe(false);
    expect(ids.has('TLX-SP-6.5-18')).toBe(false);
    expect(ids.has('TS3-3.5-7')).toBe(false);
    expect(ids.has('N1-3.5-7')).toBe(false);
  });
});
