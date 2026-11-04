import { applySharpness, createSharpeningDetail } from './sharpening';

describe('Panorama display sharpening', () => {
  it('restores the original pixels exactly at 1× without changing the source', () => {
    const source = new Uint8ClampedArray([0, 20, 80, 160, 255]);
    const original = source.slice();
    const detail = createSharpeningDetail(source, 5, 1);
    const stronger = applySharpness(source, detail, 5);
    expect(stronger).not.toEqual(original);
    expect(source).toEqual(original);
    expect(applySharpness(source, detail, 1)).toEqual(original);
  });

  it('leaves constant images unchanged, including borders and a single pixel', () => {
    for (const [width, height] of [
      [7, 5],
      [1, 1],
      [1, 8],
      [8, 1],
    ]) {
      const source = new Uint8ClampedArray(width * height).fill(123);
      expect(applySharpness(source, createSharpeningDetail(source, width, height), 5)).toEqual(
        source
      );
    }
  });

  it('increases edge contrast progressively and clamps display values', () => {
    const source = new Uint8ClampedArray([80, 80, 80, 160, 160, 160]);
    const detail = createSharpeningDetail(source, 6, 1);
    const medium = applySharpness(source, detail, 2);
    const strong = applySharpness(source, detail, 5);
    expect(medium[3] - medium[2]).toBeGreaterThan(source[3] - source[2]);
    expect(strong[3] - strong[2]).toBeGreaterThan(medium[3] - medium[2]);
    expect(strong[2]).toBe(0);
    expect(strong[3]).toBe(255);
    const subtle = new Uint8ClampedArray([100, 100, 100, 110, 110, 110]);
    const subtleDetail = createSharpeningDetail(subtle, 6, 1);
    const five = applySharpness(subtle, subtleDetail, 5);
    const ten = applySharpness(subtle, subtleDetail, 10);
    expect(ten[3] - ten[2]).toBeGreaterThan(five[3] - five[2]);
  });

  it('does not wrap right edge pixels into the next row', () => {
    const source = new Uint8ClampedArray(21);
    source[6] = 255;
    const detail = createSharpeningDetail(source, 7, 3);
    expect(detail[7]).toBe(0);
    expect(detail[14]).toBe(0);
    expect(detail[5]).toBeLessThan(0);
    expect(detail[13]).toBeLessThan(0);
  });
});
