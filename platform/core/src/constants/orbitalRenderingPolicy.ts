// Product policy: retire coarse 64/128 MiB profiles; never publish an arbitrarily sparse Z texture.
export const MINIMUM_TEXTURE_BUDGET = 256 * 1024 ** 2;
// Engineering guard against extreme decimation, not a clinical assessment of a particular study.
export const MAXIMUM_Z_DECIMATION = 2;
export const TEXTURE_BUDGET_STEPS = [256, 384, 512, 640, 768].map(mib => mib * 1024 ** 2);

/** Smallest supported budget which can retain the allowed number of Z samples. */
export function minimumDisplayBudget(width: number, height: number, depth: number, bytesPerVoxel: number) {
  const minimum = width * height * Math.ceil(depth / MAXIMUM_Z_DECIMATION) * bytesPerVoxel;
  return TEXTURE_BUDGET_STEPS.find(bytes => bytes >= minimum) ?? Infinity;
}
