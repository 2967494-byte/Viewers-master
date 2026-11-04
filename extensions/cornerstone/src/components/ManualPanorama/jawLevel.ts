type Level = { xy: number[][]; z: number; score: number; support: number };

/** Localize a vertically continuous jaw band first; its brightest inferior slice may be the chin. */
export function jawLevelOptions<T extends Level>(
  levels: T[],
  spacing: number,
  stepZ: number,
  zmin: number,
  zmax: number
): { preferred: T; candidates: T[] } | undefined {
  const bands: T[][] = [];
  for (const level of [...levels].sort((a, b) => a.z - b.z)) {
    const band = bands[bands.length - 1],
      previous = band?.[band.length - 1];
    const signature = (item: T) => {
      const first = item.xy[0],
        last = item.xy[item.xy.length - 1];
      return [
        ((first[0] + last[0]) / 2) * spacing,
        Math.min(...item.xy.map(p => p[1])) * spacing,
        Math.abs(first[0] - last[0]) * spacing,
      ];
    };
    const a = previous && signature(previous),
      b = signature(level);
    if (
      previous &&
      level.z - previous.z <= stepZ * 2.2 &&
      Math.abs(a[0] - b[0]) < 15 &&
      Math.abs(a[1] - b[1]) < 15 &&
      b[2] / a[2] > 0.5 &&
      b[2] / a[2] < 2
    )
      band.push(level);
    else bands.push([level]);
  }
  const inferiorTop = zmin + (zmax - zmin) * 0.55;
  const anchored = bands.filter(band => band.some(level => level.z <= inferiorTop));
  const eligible = anchored.length
    ? anchored
    : bands.filter(band => band.some(level => level.support >= 0.8));
  // Do not let gradual shape changes chain the mandible, maxilla and midface into one tall
  // "jaw" band. The height bound is a conservative search heuristic, not an anatomical label.
  const windows = eligible.map(source => ({
    source,
    window: source.filter(level => level.z - source[0].z <= 45),
  }));
  const quality = (band: T[]) => {
    const span = band[band.length - 1].z - band[0].z;
    const mean = band.reduce((sum, item) => sum + item.score, 0) / band.length;
    return mean + 0.15 * Math.log1p(span) + 0.1 * Math.min(5, band.length);
  };
  // Comparable evidence lower in LPS is preferred over a brighter, taller sinus/zygoma band.
  const firstZ = Math.min(...windows.map(group => group.window[0].z));
  const rank = (band: T[]) => quality(band) - 0.015 * (band[0].z - firstZ);
  const group = windows.sort((a, b) => rank(b.window) - rank(a.window))[0];
  if (!group) return undefined;
  const band = group.window;
  // Prefer the superior portion of the bounded window over its basal cortex. This is a level
  // proposal without a tooth-count requirement, not identification of the alveolar ridge.
  const targetZ = band[0].z + (band[band.length - 1].z - band[0].z) * 0.7;
  const preferred = band.reduce((best, level) =>
    Math.abs(level.z - targetZ) < Math.abs(best.z - targetZ) ? level : best
  );
  return {
    preferred,
    candidates: group.source.filter(
      level => level.z >= preferred.z - 12 && level.z <= preferred.z + 24
    ),
  };
}

/** Retain the original fallback selection for data with no reliable cross-height evidence. */
export function chooseJawLevel<T extends Level>(
  levels: T[],
  spacing: number,
  stepZ: number,
  zmin: number,
  zmax: number
): T | undefined {
  return jawLevelOptions(levels, spacing, stepZ, zmin, zmax)?.preferred;
}
