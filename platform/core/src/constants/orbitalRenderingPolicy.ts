// Product policy: retire coarse 64/128 MiB profiles; never publish an arbitrarily sparse Z texture.
export const MINIMUM_TEXTURE_BUDGET = 256 * 1024 ** 2;
// Engineering guard against extreme decimation, not a clinical assessment of a particular study.
export const MAXIMUM_Z_DECIMATION = 2;
