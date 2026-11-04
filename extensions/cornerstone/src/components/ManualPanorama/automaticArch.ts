import type { Point3, Sampler } from './reconstruction';
import { extendPosteriorCoverage, fullArchControls } from './posteriorCoverage';
import { jawLevelOptions } from './jawLevel';
import { refineAnteriorCoverage } from './anteriorCoverage';
import { chooseCoveredJawLevel } from './levelCoverage';

export type WorldBounds = [number, number, number, number, number, number];
export type AutomaticArch = {
  points: Point3[];
  sliceZ: number;
  support: number;
  coverageWarning?: string;
};
type Plane = { z: number; pixels: Float32Array };
type Candidate = {
  xy: number[][];
  score: number;
  support: number;
  z: number;
  posteriorRead: (x: number, y: number) => number;
};

const checkCancelled = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
};
const yieldToUI = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const quantile = (sorted: number[], q: number) => sorted[Math.floor((sorted.length - 1) * q)];
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const failure = () =>
  new Error('Не удалось уверенно найти костную дугу челюсти. Постройте её вручную.');

/** Patient LPS bounds, including oblique/reversed source slices. No assumption about voxel axes. */
export function volumeWorldBounds(
  dimensions: number[],
  indexToWorld: (p: number[]) => number[]
): WorldBounds {
  const bounds: WorldBounds = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (let mask = 0; mask < 8; mask++) {
    const p = indexToWorld(dimensions.map((n, axis) => (mask & (1 << axis) ? n - 1 : 0)));
    p.forEach((v, axis) => {
      bounds[2 * axis] = Math.min(bounds[2 * axis], v);
      bounds[2 * axis + 1] = Math.max(bounds[2 * axis + 1], v);
    });
  }
  return bounds;
}

/**
 * Data-driven, editable arch proposal. Axial short-slab projections + a smooth polar ridge path.
 * Shape constraints restrict the search; unsupported template arcs are never returned as a result.
 * Sampling is bounded to 40 × 160 × 160 floats, independent of the decoded volume size.
 * Background: https://pmc.ncbi.nlm.nih.gov/articles/PMC5594999/ (not a reproduction of that method).
 */
export async function detectDentalArch({
  sample,
  bounds,
  signal,
  onProgress = () => {},
}: {
  sample: Sampler;
  bounds: WorldBounds;
  signal: AbortSignal;
  onProgress?: (percent: number) => void;
}): Promise<AutomaticArch> {
  checkCancelled(signal);
  if (!bounds.every(Number.isFinite)) throw failure();
  const [xmin, xmax, ymin, ymax, zmin, zmax] = bounds;
  const sx = xmax - xmin,
    sy = ymax - ymin,
    sz = zmax - zmin;
  if (sx < 35 || sy < 30 || sz < 4 || Math.max(sx, sy, sz) > 600) throw failure();
  const spacing = Math.max(1.2, sx / 159, sy / 159);
  const width = Math.floor(sx / spacing) + 1,
    height = Math.floor(sy / spacing) + 1;
  const count = Math.min(40, Math.max(3, Math.ceil(sz / 4)));
  const planes: Plane[] = [];
  const values: number[] = [];
  for (let k = 0; k < count; k++) {
    checkCancelled(signal);
    const z = zmin + ((k + 0.5) * sz) / count;
    const pixels = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      if (y % 20 === 0) {
        await yieldToUI();
        checkCancelled(signal);
      }
      for (let x = 0; x < width; x++) {
        let maximum = -Infinity;
        for (const dz of [-2, 0, 2]) {
          const value = sample(xmin + x * spacing, ymin + y * spacing, z + dz);
          if (Number.isFinite(value)) maximum = Math.max(maximum, value);
        }
        pixels[y * width + x] = maximum;
        if ((y * width + x) % 17 === 0 && Number.isFinite(maximum)) values.push(maximum);
      }
    }
    planes.push({ z, pixels });
    onProgress(Math.round((55 * (k + 1)) / count));
  }
  values.sort((a, b) => a - b);
  if (values.length < 100) throw failure();
  const low = quantile(values, 0.6),
    high = quantile(values, 0.995);
  if (!(high - low > 1e-3)) throw failure();
  const isExtendedWall = (xy: number[][], z: number) => {
    const core = xy.slice(5, 36);
    // An open/cropped forehead can evade the closed-cavity cue. Its wall continues for many
    // centimetres vertically; the anterior alveolar horseshoe should not do so at the same XY.
    return [-1, 1].some(direction =>
      [20, 40].every(mm => {
        const target = z + direction * mm;
        const reference = planes.reduce((best, plane) =>
          Math.abs(plane.z - target) < Math.abs(best.z - target) ? plane : best
        );
        if (Math.abs(reference.z - target) > Math.max(2.5, (sz / count) * 0.6)) return false;
        const supported = core.filter(([x, y]) => {
          const i = Math.round(x),
            j = Math.round(y);
          let maximum = -Infinity;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              if (i + dx >= 0 && i + dx < width && j + dy >= 0 && j + dy < height)
                maximum = Math.max(maximum, reference.pixels[(j + dy) * width + i + dx]);
            }
          return maximum > low + 0.3 * (high - low);
        }).length;
        return supported / core.length >= 0.7;
      })
    );
  };
  const levels: Candidate[] = [];
  for (let index = 0; index < planes.length; index++) {
    checkCancelled(signal);
    const { pixels, z } = planes[index];
    let levelBest: Candidate | undefined = undefined;
    // Normalize each level enough to retain weak alveolar bone in an edentulous jaw.
    // A global floor prevents amplification of air/noise; bright isolated teeth are clipped.
    const levelValues = Array.from(pixels)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const levelHigh = levelValues.length ? quantile(levelValues, 0.99) : low;
    const effectiveHigh = Math.max(low + (high - low) * 0.45, Math.min(high, levelHigh));
    const normalized = Float32Array.from(pixels, v =>
      Number.isFinite(v) ? clamp((v - low) / (effectiveHigh - low)) : 0
    );
    const blurred = new Float32Array(pixels.length);
    const xs: number[] = [],
      ys: number[] = [];
    for (let y = 1; y < height - 1; y++)
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        blurred[i] =
          (normalized[i] * 4 +
            normalized[i - 1] +
            normalized[i + 1] +
            normalized[i - width] +
            normalized[i + width]) /
          8;
        if (blurred[i] > 0.5) {
          xs.push(x);
          ys.push(y);
        }
      }
    if (xs.length >= 30) {
      const cavities = largeEnclosedCavities(blurred, width, height, spacing);
      const cranialCavities = cavities.cranial;
      const insideCranium = (x: number, y: number) => {
        const i = Math.round(x),
          j = Math.round(y);
        return i >= 0 && j >= 0 && i < width && j < height && !!cranialCavities[j * width + i];
      };
      xs.sort((a, b) => a - b);
      ys.sort((a, b) => a - b);
      const xlo = quantile(xs, 0.03),
        xhi = quantile(xs, 0.97);
      const ylo = quantile(ys, 0.03),
        yhi = quantile(ys, 0.97);
      const read = planeReader(blurred, width, height);
      for (const ratio of [0.28, 0.36, 0.46])
        for (const aspect of [0.8, 1, 1.2]) {
          const rx = (xhi - xlo) * ratio,
            ry = rx * aspect;
          if (rx * spacing < 18 || rx * spacing > 60 || ry * spacing < 18 || ry * spacing > 65)
            continue;
          for (const anterior of [0, 0.12, 0.24])
            for (const shift of [-4, 0, 4]) {
              const cx = (xlo + xhi) / 2 + shift / spacing;
              const cy = ylo + (yhi - ylo) * anterior + ry;
              // The anterior half of a cranial shell also looks like a perfect dental U.
              if (insideCranium(cx, cy - ry * 0.3)) continue;
              const candidate = traceRidge(
                read,
                insideCranium,
                cx,
                cy,
                rx,
                ry,
                spacing,
                width,
                height
              );
              if (
                !candidate ||
                isExtendedWall(candidate.xy, z) ||
                enclosesPairedCavities(candidate.xy, cavities.small, spacing)
              )
                continue;
              if (!levelBest || candidate.score > levelBest.score)
                levelBest = { ...candidate, z, posteriorRead: read };
            }
        }
    }
    if (levelBest) {
      levelBest.posteriorRead = posteriorPlaneReader(planes, z, low, effectiveHigh, width, height);
      levels.push(levelBest);
    }
    onProgress(55 + Math.round((35 * (index + 1)) / planes.length));
    await yieldToUI();
  }
  checkCancelled(signal);
  // Validate posterior coverage BEFORE choosing a level. Otherwise an attractive midface U
  // could win first, and a warning would leave the user with a known-unreliable panorama.
  const safeLevels = levels
    .map(level => ({
      ...level,
      complete: extendPosteriorCoverage({
        path: level.xy,
        read: level.posteriorRead,
        spacing,
        width,
        height,
      }),
    }))
    .filter(level => !level.complete.unsafe);
  const options = jawLevelOptions(safeLevels, spacing, sz / count, zmin, zmax);
  if (!options) throw failure();
  type PreparedLevel = typeof options.preferred & {
    path: number[][];
    front: number[][];
    right: number[][];
    left: number[][];
  };
  const candidates: PreparedLevel[] = [];
  for (let index = 0; index < options.candidates.length; index++) {
    checkCancelled(signal);
    const level = options.candidates[index];
    const anterior = refineAnteriorCoverage({
      path: level.xy,
      read: level.posteriorRead,
      spacing,
      width,
      height,
    });
    const complete = level.complete;
    const seedStart = complete.path.indexOf(level.xy[0]);
    if (anterior.confirmed && seedStart >= 0) {
      // Only the anterior seed changes; posterior tracking and its safeguards are preserved.
      const path = [
        ...complete.path.slice(0, seedStart),
        ...anterior.path,
        ...complete.path.slice(seedStart + level.xy.length),
      ];
      const length = path
        .slice(1)
        .reduce((sum, p, i) => sum + Math.hypot(p[0] - path[i][0], p[1] - path[i][1]) * spacing, 0);
      if (length <= 240)
        candidates.push({
          ...level,
          path,
          front: anterior.path.slice(12, 29),
          right: path.slice(0, seedStart + 8),
          left: path.slice(seedStart + 33),
        });
    }
    onProgress(90 + Math.round((10 * (index + 1)) / options.candidates.length));
    await yieldToUI();
  }
  checkCancelled(signal);
  const fallback =
    candidates.find(level => level.z === options.preferred.z) ||
    [...candidates].sort(
      (a, b) => Math.abs(a.z - options.preferred.z) - Math.abs(b.z - options.preferred.z)
    )[0];
  if (!fallback)
    throw new Error('Не удалось уверенно найти передний отдел дуги. Постройте её вручную.');
  const best = chooseCoveredJawLevel(candidates, fallback, spacing, sz / count);
  const complete = best.complete;
  const points = fullArchControls(best.path, spacing).map(
    ([x, y]) => [xmin + x * spacing, ymin + y * spacing, best.z] as Point3
  );
  return {
    points,
    sliceZ: best.z,
    support: best.support,
    ...(complete.fieldLimited
      ? {
          coverageWarning:
            'Полное включение задних отделов не подтверждено: достигнута граница поиска. Проверьте моляры и поправьте концы дуги.',
        }
      : {}),
  };
}

// Own the selected plane in a separate invocation: async/regenerator builds must not capture
// the loop's mutable plane binding when posterior tracing runs after the scan has finished.
function planeReader(image: Float32Array, width: number, height: number) {
  return (x: number, y: number) => {
    const i = Math.floor(x),
      j = Math.floor(y);
    if (i < 1 || j < 1 || i >= width - 2 || j >= height - 2) return 0;
    const fx = x - i,
      fy = y - j,
      p = j * width + i;
    return (
      (image[p] * (1 - fx) + image[p + 1] * fx) * (1 - fy) +
      (image[p + width] * (1 - fx) + image[p + width + 1] * fx) * fy
    );
  };
}

// Use a bounded neighbourhood in Z to keep posterior bone/tooth support when the dental
// row is tilted relative to the chosen axial plane. CPR still samples ORIGINAL voxels;
// this projection is only a search cue, never a replacement for the reconstruction data.
function posteriorPlaneReader(
  planes: Plane[],
  z: number,
  low: number,
  high: number,
  width: number,
  height: number
) {
  const image = new Float32Array(width * height);
  for (const plane of planes) {
    if (Math.abs(plane.z - z) > 8) continue;
    for (let i = 0; i < image.length; i++) {
      const v = plane.pixels[i];
      if (Number.isFinite(v)) image[i] = Math.max(image[i], clamp((v - low) / (high - low)));
    }
  }
  const blurred = new Float32Array(image.length);
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      blurred[i] =
        (4 * image[i] + image[i - 1] + image[i + 1] + image[i - width] + image[i + width]) / 8;
    }
  return planeReader(blurred, width, height);
}

function traceRidge(
  read: (x: number, y: number) => number,
  insideCranium: (x: number, y: number) => boolean,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  spacing: number,
  width: number,
  height: number
) {
  const n = 41,
    m = 25;
  const back = new Int16Array(n * m);
  const positions: number[][][] = [];
  let previous = new Float32Array(m);
  const emission: number[][] = [];
  for (let a = 0; a < n; a++) {
    const angle = Math.PI + (a * Math.PI) / (n - 1),
      co = Math.cos(angle),
      si = Math.sin(angle);
    const offsets: number[][] = [],
      row: number[] = [],
      next = new Float32Array(m);
    for (let r = 0; r < m; r++) {
      const scale = 0.7 + r * 0.025,
        x = cx + co * rx * scale,
        y = cy + si * ry * scale;
      offsets.push([x, y]);
      const norm = Math.hypot(rx * co, ry * si),
        dx = (rx * co) / norm,
        dy = (ry * si) / norm;
      const ridge = read(x, y),
        inner = read(x - (dx * 6) / spacing, y - (dy * 6) / spacing),
        outer = read(x + (dx * 6) / spacing, y + (dy * 6) / spacing);
      const value = 1.6 * ridge - 0.5 * (inner + outer) - 0.03 * (scale - 1) ** 2;
      row.push(ridge);
      if (!a) {
        next[r] = value;
        continue;
      }
      let winner = -Infinity,
        from = r;
      for (let p = Math.max(0, r - 2); p <= Math.min(m - 1, r + 2); p++) {
        const score = previous[p] - 0.065 * (p - r) ** 2;
        if (score > winner) {
          winner = score;
          from = p;
        }
      }
      next[r] = winner + value;
      back[a * m + r] = from;
    }
    positions.push(offsets);
    emission.push(row);
    previous = next;
  }
  let r = previous.indexOf(Math.max(...previous));
  const xy: number[][] = [],
    intensities: number[] = [];
  const finalScore = previous[r] / n;
  for (let a = n - 1; a >= 0; a--) {
    xy.unshift(positions[a][r]);
    intensities.unshift(emission[a][r]);
    r = back[a * m + r];
  }
  // Reject missing arms, clipped fields, solid bright blocks and unsupported shape guesses.
  const support = intensities.filter(v => v > 0.35).length / n;
  const armSupport = (begin: number, end: number) =>
    intensities.slice(begin, end).filter(v => v > 0.35).length / (end - begin);
  const mean = intensities.reduce((sum, v) => sum + v, 0) / n;
  const interior = read(cx, cy - ry * 0.3);
  const cranialSupport =
    xy.filter(([x, y]) => {
      const d = Math.hypot(x - cx, y - cy),
        f = Math.min(0.4, 8 / (spacing * d));
      return insideCranium(x + (cx - x) * f, y + (cy - y) * f);
    }).length / n;
  // Closed posterior bone contours distinguish skull rings from an open alveolar horseshoe.
  const posterior =
    xy.slice(6, 35).filter(([x, y]) => {
      const reflectedY = 2 * cy - y;
      return (
        Math.max(
          read(x, reflectedY),
          read(x, reflectedY - 3 / spacing),
          read(x, reflectedY + 3 / spacing)
        ) > 0.35
      );
    }).length / 29;
  const physicalWidth = (xy[n - 1][0] - xy[0][0]) * spacing;
  const depth = ((xy[0][1] + xy[n - 1][1]) / 2 - Math.min(...xy.map(p => p[1]))) * spacing;
  if (
    support < 0.65 ||
    armSupport(0, 12) < 0.5 ||
    armSupport(29, 41) < 0.5 ||
    mean < 0.42 ||
    mean - interior < 0.12 ||
    cranialSupport > 0.25 ||
    posterior > 0.6 ||
    finalScore < 0.48 ||
    physicalWidth < 35 ||
    physicalWidth > 120 ||
    depth < 18 ||
    depth > 70 ||
    xy.some(([x, y]) => x < 2 || y < 2 || x > width - 3 || y > height - 3)
  )
    return null;
  return { xy, support, score: finalScore + 0.25 * support + 0.2 * (mean - interior) };
}

/** Large low-density regions enclosed by bone are cranial-cavity exclusion cues, not a segmentation. */
function largeEnclosedCavities(
  image: Float32Array,
  width: number,
  height: number,
  spacing: number
) {
  const size = image.length;
  const barrier = new Uint8Array(size),
    visited = new Uint8Array(size),
    result = new Uint8Array(size);
  const small: number[][] = [];
  const queue = new Int32Array(size);
  // A one-cell dilation closes sampling gaps in a thin cranial wall, without closing a jaw's open back.
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      if (image[y * width + x] < 0.32) continue;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) barrier[(y + dy) * width + x + dx] = 1;
    }
  for (let first = 0; first < size; first++) {
    if (barrier[first] || visited[first]) continue;
    let start = 0,
      end = 1,
      edge = false,
      xlo = width,
      xhi = 0,
      ylo = height,
      yhi = 0;
    queue[0] = first;
    visited[first] = 1;
    while (start < end) {
      const i = queue[start++],
        x = i % width,
        y = Math.floor(i / width);
      xlo = Math.min(xlo, x);
      xhi = Math.max(xhi, x);
      ylo = Math.min(ylo, y);
      yhi = Math.max(yhi, y);
      if (!x || !y || x === width - 1 || y === height - 1) edge = true;
      for (const j of [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y < height - 1 ? i + width : -1,
      ]) {
        if (j < 0 || barrier[j] || visited[j]) continue;
        visited[j] = 1;
        queue[end++] = j;
      }
    }
    if (
      !edge &&
      end * spacing ** 2 > 1200 &&
      (xhi - xlo) * spacing > 32 &&
      (yhi - ylo) * spacing > 28
    ) {
      for (let k = 0; k < end; k++) result[queue[k]] = 1;
    } else if (
      !edge &&
      end * spacing ** 2 > 80 &&
      (xhi - xlo) * spacing > 6 &&
      (yhi - ylo) * spacing > 6
    ) {
      small.push([(xlo + xhi) / 2, (ylo + yhi) / 2]);
    }
  }
  return { cranial: result, small };
}

/** Paired enclosed spaces inside the anterior U are a midface exclusion cue, not tooth evidence. */
function enclosesPairedCavities(xy: number[][], cavities: number[][], spacing: number) {
  const first = xy[0],
    last = xy[xy.length - 1];
  const cx = (first[0] + last[0]) / 2;
  const front = Math.min(...xy.map(p => p[1]));
  const back = (first[1] + last[1]) / 2;
  const inside = cavities.filter(
    ([x, y]) =>
      // Include neighbouring space: a false narrow seed can follow one sinus wall and
      // exclude the centre of the contralateral cavity from its own bounding box.
      x > first[0] - 12 / spacing &&
      x < last[0] + 12 / spacing &&
      y > front + 4 / spacing &&
      // A short anterior seed can end in front of the cavities; include the region in which
      // posterior tracking would otherwise start following their outer walls.
      y < back + 20 / spacing
  );
  return inside.some(([x]) => x < cx - 6 / spacing) && inside.some(([x]) => x > cx + 6 / spacing);
}
