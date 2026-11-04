type XY = [number, number];

/** Continue BOTH dental branches posteriorly in LPS +Y, rather than stopping at a fitted semicircle. */
export function extendPosteriorCoverage({
  path,
  read,
  spacing,
  width,
  height,
}: {
  path: number[][];
  read: (x: number, y: number) => number;
  spacing: number;
  width: number;
  height: number;
}): { path: number[][]; fieldLimited: boolean; unsafe: boolean } {
  const seedWidth = Math.abs(path[path.length - 1][0] - path[0][0]) * spacing;
  const frontY = Math.min(...path.map(p => p[1]));
  // A bright lingual cortex alone must not pull CPR away from the centre of the alveolar
  // process. Paired lateral borders support their midpoint even if its density is lower.
  // Keep single-border evidence usable in edentulous/partially visible bone.
  const branchEvidence = (x: number, y: number) => {
    let value = read(x, y);
    for (const mm of [3, 4, 5, 6, 7, 8]) {
      const pair = Math.sqrt(Math.max(0, read(x - mm / spacing, y) * read(x + mm / spacing, y)));
      value = Math.max(value, pair * 1.7);
    }
    return value;
  };
  const follow = (seed: number[], side: number) => {
    // Follow the lateral alveolar branch. A route towards the midline can instead connect to
    // the spine; a route far outside the seed can connect to the zygoma/temporal bone.
    const inward = Math.min(4, seedWidth * 0.06) / spacing;
    const outward = Math.min(18, seedWidth * 0.3) / spacing;
    const lo = Math.max(2, Math.ceil(seed[0] - (side < 0 ? outward : inward)));
    const hi = Math.min(width - 3, Math.floor(seed[0] + (side < 0 ? inward : outward)));
    if (lo > hi) return { tail: [seed], fieldLimited: true, unsafe: true };
    const columns = hi - lo + 1;
    const searchRows = Math.floor(
      Math.min(60, seedWidth * 1.1, 85 - (seed[1] - frontY) * spacing) / spacing
    );
    const rows = Math.max(0, Math.min(searchRows, Math.floor(height - 3 - seed[1])));
    const back = new Int16Array((rows + 1) * columns);
    let previous = new Float32Array(columns).fill(-Infinity);
    let previousGap = new Float32Array(columns);
    for (let x = lo; x <= hi; x++)
      if (Math.abs(x - seed[0]) * spacing <= 5)
        previous[x - lo] = -0.08 * ((x - seed[0]) * spacing) ** 2;
    let winner = {
      score: 0,
      row: 0,
      column: Math.max(0, Math.min(columns - 1, Math.round(seed[0]) - lo)),
    };
    for (let row = 1; row <= rows; row++) {
      const y = seed[1] + row;
      const next = new Float32Array(columns).fill(-Infinity);
      const nextGap = new Float32Array(columns);
      for (let c = 0; c < columns; c++) {
        const x = lo + c,
          value = branchEvidence(x, y);
        // Weak continuous alveolar bone remains usable even when only posterior teeth are present.
        const flankPenalty =
          value > read(x, y) + 0.1
            ? 0
            : 0.18 * (read(x - 5 / spacing, y) + read(x + 5 / spacing, y));
        const emission = 1.8 * value - 0.35 - flankPenalty;
        let best = -Infinity,
          from = c;
        for (let p = Math.max(0, c - 2); p <= Math.min(columns - 1, c + 2); p++) {
          const gap = value >= 0.2 ? 0 : previousGap[p] + spacing;
          if (gap > 8) continue;
          const score = previous[p] - 0.06 * (p - c) ** 2;
          if (score > best) {
            best = score;
            from = p;
          }
        }
        next[c] = best + emission;
        nextGap[c] = value >= 0.2 ? 0 : previousGap[from] + spacing;
        back[row * columns + c] = from;
        if (row * spacing >= 3 && value >= 0.25 && next[c] > winner.score)
          winner = { score: next[c], row, column: c };
      }
      previous = next;
      previousGap = nextGap;
    }
    const tail: number[][] = [];
    let c = winner.column;
    for (let row = winner.row; row > 0; row--) {
      tail.unshift([lo + c, seed[1] + row]);
      c = back[row * columns + c];
    }
    tail.unshift([...seed]);
    // A posterior endpoint is the far side of the supported bone/tooth, plus a 5 mm display margin.
    const last = tail[tail.length - 1],
      before = tail[Math.max(0, tail.length - 4)];
    const direction = tail.length > 1 ? [last[0] - before[0], last[1] - before[1]] : [0, 1];
    const norm = Math.hypot(...direction) || 1;
    let fieldLimited =
      winner.row >= rows - 1 && winner.row > 0 && branchEvidence(last[0], last[1]) >= 0.25;
    // Reaching an artificial search bound is not evidence that the last molar was included.
    // Reject that proposal rather than displaying a truncated or spine-following result.
    const unsafe = fieldLimited && rows >= searchRows - 1;
    let padding = 0;
    for (let mm = 1; mm <= 5; mm++) {
      const p = [
        last[0] + ((direction[0] / norm) * mm) / spacing,
        last[1] + ((direction[1] / norm) * mm) / spacing,
      ];
      if (p[0] < 1 || p[0] > width - 2 || p[1] < 1 || p[1] > height - 2) {
        fieldLimited = true;
        break;
      }
      padding = mm;
    }
    if (padding)
      tail.push([
        last[0] + ((direction[0] / norm) * padding) / spacing,
        last[1] + ((direction[1] / norm) * padding) / spacing,
      ]);
    return { tail, fieldLimited, unsafe };
  };
  const right = follow(path[0], -1),
    left = follow(path[path.length - 1], 1);
  const complete = [...right.tail.slice(1).reverse(), ...path, ...left.tail.slice(1)];
  const length = complete
    .slice(1)
    .reduce(
      (sum, p, i) => sum + Math.hypot(p[0] - complete[i][0], p[1] - complete[i][1]) * spacing,
      0
    );
  return {
    path: complete,
    fieldLimited: right.fieldLimited || left.fieldLimited,
    unsafe: right.unsafe || left.unsafe || length > 240,
  };
}

/** Preserve both posterior ends and a roughly 8 mm control spacing through the entire arch. */
export function fullArchControls(path: number[][], spacing: number): XY[] {
  const distances = [0];
  for (let i = 1; i < path.length; i++)
    distances.push(
      distances[i - 1] +
        Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]) * spacing
    );
  const total = distances[distances.length - 1];
  const count = Math.min(29, Math.max(11, Math.ceil(total / 8) + 1));
  let segment = 1;
  return Array.from({ length: count }, (_, i) => {
    const d = (total * i) / (count - 1);
    while (segment < path.length - 1 && distances[segment] < d) segment++;
    const t = (d - distances[segment - 1]) / (distances[segment] - distances[segment - 1] || 1);
    return path[segment - 1].map((v, axis) => v + t * (path[segment][axis] - v)) as XY;
  });
}
