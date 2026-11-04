export type CoverageLevel = {
  z: number;
  path: number[][];
  front: number[][];
  right: number[][];
  left: number[][];
};

function distanceToPath(p: number[], path: number[][], spacing: number) {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i];
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const t = Math.max(
      0,
      Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))
    );
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) * spacing);
  }
  return best;
}
const coverage = (points: number[][], path: number[][], spacing: number) =>
  points.length
    ? points.reduce(
        (sum, p) => sum + Math.max(0, Math.min(1, (11 - distanceToPath(p, path, spacing)) / 6)),
        0
      ) / points.length
    : 0;
const centralFront = (level: CoverageLevel) => {
  const middle = Math.floor(level.front.length / 2);
  return level.front.slice(Math.max(0, middle - 2), middle + 3);
};
const frontCoverage = (reference: CoverageLevel, path: number[][], spacing: number) =>
  Math.min(
    coverage(reference.front, path, spacing),
    coverage(centralFront(reference), path, spacing)
  );
const matches = (a: CoverageLevel, b: CoverageLevel, spacing: number) =>
  [a.front, centralFront(a), a.right, a.left].every(
    points =>
      points.length &&
      points.reduce((sum, p) => sum + distanceToPath(p, b.path, spacing), 0) / points.length < 4
  ) &&
  [b.front, centralFront(b), b.right, b.left].every(
    points =>
      points.length &&
      points.reduce((sum, p) => sum + distanceToPath(p, a.path, spacing), 0) / points.length < 4
  );

/** Additive override: leave the established fallback unless repeatable superior evidence exposes
 * a front coverage deficit, and an alternative covers the front AND both posterior branches. */
export function chooseCoveredJawLevel<T extends CoverageLevel>(
  candidates: T[],
  preferred: T,
  spacing: number,
  stepZ: number
): T {
  const upper = candidates
    .filter(level => level.z >= preferred.z + stepZ && level.z <= preferred.z + 24)
    .sort((a, b) => b.z - a.z);
  let references: T[] = [];
  for (let i = 0; i < upper.length - 1; i++)
    if (upper[i].z - upper[i + 1].z <= stepZ * 1.6 && matches(upper[i], upper[i + 1], spacing)) {
      references = [upper[i], upper[i + 1]];
      break;
    }
  if (!references.length) return preferred;
  const assess = (level: T) => {
    const values = references.map(ref => [
      frontCoverage(ref, level.path, spacing),
      coverage(ref.right, level.path, spacing),
      coverage(ref.left, level.path, spacing),
    ]);
    return [
      Math.min(...values.map(v => v[0])),
      Math.min(coverage(preferred.right, level.path, spacing), ...values.map(v => v[1])),
      Math.min(coverage(preferred.left, level.path, spacing), ...values.map(v => v[2])),
    ];
  };
  const baseline = assess(preferred);
  if (baseline[0] >= 0.9) return preferred;
  const baselineScore = (baseline[0] + Math.min(baseline[1], baseline[2])) / 2;
  let best = preferred,
    bestScore = baselineScore;
  for (const level of candidates) {
    const [front, right, left] = assess(level);
    const score = (front + Math.min(right, left)) / 2;
    if (
      front < 0.85 ||
      right < 0.8 ||
      left < 0.8 ||
      right < baseline[1] - 0.05 ||
      left < baseline[2] - 0.05 ||
      front < baseline[0] + 0.15
    )
      continue;
    if (
      score > baselineScore + 0.08 &&
      (score > bestScore + 1e-6 ||
        (Math.abs(score - bestScore) <= 1e-6 &&
          Math.abs(level.z - preferred.z) < Math.abs(best.z - preferred.z)))
    ) {
      best = level;
      bestScore = score;
    }
  }
  return best;
}
