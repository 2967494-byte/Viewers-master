type XY = number[];

/** Refine the anterior bend from image evidence while keeping both lateral shoulders fixed. */
export function refineAnteriorCoverage({
  path,
  read,
  spacing,
  width,
  height,
}: {
  path: XY[];
  read: (x: number, y: number) => number;
  spacing: number;
  width: number;
  height: number;
}): { path: XY[]; confirmed: boolean } {
  if (path.length < 11) return { path, confirmed: false };
  const start = Math.floor((path.length - 1) * 0.2);
  const end = path.length - 1 - start;
  const offsets = Array.from({ length: 39 }, (_, i) => -3 + i * 0.5);
  const zero = offsets.indexOf(0);
  const rows = end - start + 1,
    cols = offsets.length;
  const back = new Int16Array(rows * cols);
  const positions: XY[][] = [],
    strengths: number[][] = [],
    emissions: number[][] = [];
  for (let row = 0; row < rows; row++) {
    const index = start + row;
    const before = path[index - 1],
      after = path[index + 1];
    const dx = after[0] - before[0],
      dy = after[1] - before[1];
    const norm = Math.hypot(dx, dy) || 1;
    const nx = dy / norm,
      ny = -dx / norm;
    const points: XY[] = [],
      support: number[] = [],
      scores: number[] = [];
    for (let c = 0; c < cols; c++) {
      const offset = offsets[c];
      const x = path[index][0] + (nx * offset) / spacing,
        y = path[index][1] + (ny * offset) / spacing;
      points.push([x, y]);
      const raw = read(x, y);
      let paired = 0;
      for (const mm of [2, 3, 4])
        paired = Math.max(
          paired,
          Math.sqrt(
            Math.max(
              0,
              read(x - (nx * mm) / spacing, y - (ny * mm) / spacing) *
                read(x + (nx * mm) / spacing, y + (ny * mm) / spacing)
            )
          )
        );
      const value = Math.max(raw, paired * 1.5);
      support.push(value);
      const flanks =
        read(x - (nx * 5) / spacing, y - (ny * 5) / spacing) +
        read(x + (nx * 5) / spacing, y + (ny * 5) / spacing);
      const emission =
        1.5 * value -
        (value > raw + 0.1 ? 0 : 0.3 * flanks) -
        0.35 +
        (value >= 0.35 ? Math.max(0, offset) * 0.015 : 0);
      scores.push(x < 2 || y < 2 || x > width - 3 || y > height - 3 ? -Infinity : emission);
    }
    positions.push(points);
    strengths.push(support);
    emissions.push(scores);
  }
  const middle = Math.floor(rows / 2);
  // A second, continuous anterior ridge can be as bright as the inner shortcut after
  // normalization. Prefer its supported outer envelope only when it spans BOTH sides of
  // the centre; an isolated restoration/bright spot is insufficient evidence for that change.
  const targets = strengths.map((values, row) => {
    const threshold = Math.max(0.45, Math.max(...values) * 0.65);
    let target = 0;
    for (let c = 1; c < cols - 1; c++)
      if (
        offsets[c] >= 4 &&
        values[c] >= threshold &&
        values[c] >= values[c - 1] &&
        values[c] >= values[c + 1] &&
        Number.isFinite(emissions[row][c])
      )
        target = offsets[c];
    return target;
  });
  const hasOuterEnvelope =
    targets.slice(middle - 4, middle).filter(v => v >= 4).length >= 2 &&
    targets.slice(middle + 1, middle + 5).filter(v => v >= 4).length >= 2 &&
    targets[middle] >= 4;
  if (hasOuterEnvelope)
    for (let row = 1; row < rows - 1; row++)
      if (targets[row] >= 4)
        for (let c = 0; c < cols; c++)
          emissions[row][c] -= 0.08 * Math.abs(offsets[c] - targets[row]);
  let previous = new Float64Array(cols).fill(-Infinity);
  previous[zero] = emissions[0][zero];
  for (let row = 1; row < rows; row++) {
    const next = new Float64Array(cols).fill(-Infinity);
    for (let c = 0; c < cols; c++) {
      if (row === rows - 1 && c !== zero) continue;
      for (let p = Math.max(0, c - 6); p <= Math.min(cols - 1, c + 6); p++) {
        const delta = offsets[c] - offsets[p];
        const score = previous[p] + emissions[row][c] - 0.06 * delta * delta;
        if (score > next[c]) {
          next[c] = score;
          back[row * cols + c] = p;
        }
      }
    }
    previous = next;
  }
  const proposed: XY[] = [],
    values: number[] = [];
  let column = zero;
  for (let row = rows - 1; row >= 0; row--) {
    proposed.unshift(positions[row][column]);
    values.unshift(strengths[row][column]);
    column = back[row * cols + column];
  }
  const supported = (v: number[]) => v.filter(x => x >= 0.35).length / v.length;
  const confirmed =
    supported(values) >= 0.7 && supported(values.slice(middle - 3, middle + 4)) >= 0.57;
  const baseline = emissions.reduce((sum, row) => sum + row[zero], 0);
  // No image-supported improvement means no invented forward bulge (important without teeth).
  if (
    !confirmed ||
    !Number.isFinite(previous[zero]) ||
    previous[zero] < baseline + rows * 0.04 ||
    proposed.some((p, i) => i > 0 && (p[0] - proposed[i - 1][0]) * spacing < -1.5)
  )
    return {
      path,
      confirmed:
        supported(strengths.map(row => row[zero])) >= 0.7 &&
        supported(strengths.slice(middle - 3, middle + 4).map(row => row[zero])) >= 0.57,
    };
  return { path: [...path.slice(0, start), ...proposed, ...path.slice(end + 1)], confirmed: true };
}
