import { magnifierCrop } from './magnifierGeometry';

describe('Screen loupe source pixels', () => {
  const bounds = { left: 10, top: 20, width: 800, height: 600 };
  it.each([2, 3, 4, 6])('keeps %s× magnification on a HiDPI viewport', zoom => {
    const crop = magnifierCrop({ width: 1600, height: 1200 }, bounds, { x: 410, y: 320 }, zoom, 220, false);
    expect(crop.sx + crop.sw / 2).toBeCloseTo(800);
    expect(crop.sy + crop.sh / 2).toBeCloseTo(600);
    expect(crop.sw / 2).toBeCloseTo(220 / zoom);
    expect(crop.sh / 2).toBeCloseTo(220 / zoom);
  });
  it('accounts for the panorama black margins without changing proportions', () => {
    const source = { width: 1000, height: 250 };
    const crop = magnifierCrop(source, bounds, { x: 410, y: 320 }, 2, 220, true);
    expect(crop.sx + crop.sw / 2).toBeCloseTo(500);
    expect(crop.sy + crop.sh / 2).toBeCloseTo(125);
    expect(crop.sw).toBeCloseTo(crop.sh);
    expect(magnifierCrop(source, bounds, { x: 410, y: 30 }, 2, 220, true)).toBeNull();
  });
  it('allows clipped image edges and rejects invalid geometry', () => {
    expect(magnifierCrop({ width: 800, height: 600 }, bounds, { x: 10, y: 20 }, 3, 220, false).sx).toBeLessThan(0);
    expect(magnifierCrop({ width: 0, height: 600 }, bounds, { x: 10, y: 20 }, 3, 220, false)).toBeNull();
  });
});
