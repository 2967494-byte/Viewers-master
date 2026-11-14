import { DENTIUM_DATA } from './dentiumData';

describe('Dentium manufacturer catalogue matrices', () => {
  const lines = DENTIUM_DATA.lines;
  const models = lines.flatMap(line => line.models);
  const get = (id: string) => models.find(model => model.id === id);

  it('keeps body, platform and gingival height distinct for all 42 SimpleLine II references', () => {
    const simple = lines.find(line => line.name === 'SimpleLine II').models;
    expect(simple).toHaveLength(42);
    expect(simple.filter(model => model.gingivalHeight === 1.6)).toHaveLength(12);
    expect(simple.filter(model => model.gingivalHeight === 2)).toHaveLength(15);
    expect(simple.filter(model => model.gingivalHeight === 2.2)).toHaveLength(15);
    expect(get('SOFX483408S')).toBeUndefined();
    expect(get('SOFX483408')).toMatchObject({
      dimensions: { diameter: 3.4, length: 8 },
      platformDiameter: 4.8,
      gingivalHeight: 2,
    });
    expect(get('SOFX654312R')).toMatchObject({
      dimensions: { diameter: 4.3, length: 12 },
      platformDiameter: 6.5,
      gingivalHeight: 2.2,
    });
    expect(get('SOFX483810S')).toMatchObject({
      dimensions: { diameter: 3.8, length: 10 },
      gingivalHeight: 1.6,
    });
    expect(simple.every(model => [8, 10, 12].includes(model.dimensions.length))).toBe(true);
  });

  it('includes the other four sourced systems without inventing unavailable lengths or confusing platform with body', () => {
    expect(lines.map(line => [line.name, line.models.length])).toEqual([
      ['SimpleLine II', 42],
      ['SuperLine II', 30],
      ['SuperLine', 22],
      ['Implantium', 16],
      ['NR Line', 6],
    ]);
    expect(get('FXS3607BC')).toBeDefined();
    expect(get('FXS3607C')).toBeUndefined();
    expect(get('FXS4507C')).toBeDefined();
    expect(get('FXS4507BC')).toBeDefined();
    expect(get('FXS6008C')).toMatchObject({
      platformDiameter: 6,
      dimensions: { diameter: 5, length: 8 },
    });
    expect(get('FXS6014C')).toBeUndefined();
    expect(get('FX7014SWC')).toBeUndefined();
    expect(get('FX6008SWC')).toMatchObject({
      platformDiameter: 6,
      dimensions: { diameter: 4.8, length: 8 },
    });
    expect(get('FX3810MLC')).toMatchObject({
      platformDiameter: 4,
      dimensions: { diameter: 3.8, length: 10 },
    });
    expect(get('GFX3009S')).toMatchObject({
      platformDiameter: 3.2,
      dimensions: { diameter: 3.1, length: 9 },
    });
    expect(get('GFX3009')).toMatchObject({
      platformDiameter: 3.6,
      dimensions: { diameter: 3.1, length: 9 },
    });
    expect(new Set(models.map(model => model.id)).size).toBe(116);
    expect(
      models.every(
        model =>
          model.catalogNumber === model.id &&
          model.sourceUrl.startsWith('https://') &&
          model.geometry === 'nominal-cylinder'
      )
    ).toBe(true);
  });
});
