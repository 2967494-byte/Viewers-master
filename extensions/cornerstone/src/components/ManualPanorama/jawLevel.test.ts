import { chooseJawLevel, jawLevelOptions } from './jawLevel';

const xy = [
  [-35, 20],
  [0, -10],
  [35, 20],
];
describe('Alveolar level within the localized jaw band', () => {
  it('does not choose the brightest basal chin slice', () => {
    const levels = Array.from({ length: 11 }, (_, i) => ({
      xy,
      z: i * 4,
      score: i === 0 ? 2 : 1.2,
      support: 0.9,
    }));
    expect(chooseJawLevel(levels, 1, 4, -10, 100).z).toBe(28);
  });
  it('follows the jaw band above the initial inferior search boundary', () => {
    const levels = Array.from({ length: 11 }, (_, i) => ({
      xy,
      z: 10 + i * 4,
      score: 1.2,
      support: 0.9,
    }));
    expect(chooseJawLevel(levels, 1, 4, 0, 60).z).toBe(38);
  });
  it('uses a short available band in an inferiorly cropped ENT field', () => {
    const levels = [5, 9, 13].map(z => ({ xy, z, score: 1.2, support: 0.9 }));
    expect(chooseJawLevel(levels, 1, 4, 5, 100).z).toBe(9);
    expect(chooseJawLevel([], 1, 4, 0, 100)).toBeUndefined();
  });
  it('does not climb a continuous jaw-to-midface chain in a large ENT field', () => {
    const levels = Array.from({ length: 27 }, (_, i) => ({
      xy,
      z: i * 4,
      score: 1.2,
      support: 0.9,
    }));
    expect(chooseJawLevel(levels, 1, 4, -10, 180).z).toBeLessThanOrEqual(44);
  });
  it('prefers a supported inferior jaw over a taller brighter midface band', () => {
    const levels = [0, 4, 8, 12, 16].map(z => ({ xy, z, score: 1.2, support: 0.9 }));
    levels.push(
      ...[40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88].map(z => ({
        xy,
        z,
        score: 1.4,
        support: 0.9,
      }))
    );
    expect(chooseJawLevel(levels, 1, 4, -10, 180).z).toBeLessThan(20);
  });
  it('limits comparison to the selected band and a bounded neighbourhood of the old level', () => {
    const levels = Array.from({ length: 26 }, (_, i) => ({
      xy,
      z: i * 4,
      score: 1.2,
      support: 0.9,
    }));
    const options = jawLevelOptions(levels, 1, 4, -10, 180);
    expect(options.preferred).toBe(chooseJawLevel(levels, 1, 4, -10, 180));
    expect(
      options.candidates.every(
        level => level.z >= options.preferred.z - 12 && level.z <= options.preferred.z + 24
      )
    ).toBe(true);
    const isolated = [...levels.slice(0, 5), ...levels.slice(10, 16)];
    const separate = jawLevelOptions(isolated, 1, 4, -10, 180);
    expect(separate.candidates.every(level => level.z < 20)).toBe(true);
  });
});
