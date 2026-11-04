/** Display-space unsharp mask. Neither the reconstructed raster nor DICOM voxels are modified. */
export function createSharpeningDetail(pixels: Uint8ClampedArray, width: number, height: number) {
  const kernel = [1, 4, 6, 4, 1];
  const horizontal = new Float32Array(pixels.length);
  const detail = new Float32Array(pixels.length);
  // Clamp each axis independently so the filter never wraps across image rows.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -2; k <= 2; k++) {
        sum += pixels[y * width + Math.max(0, Math.min(width - 1, x + k))] * kernel[k + 2];
      }
      horizontal[y * width + x] = sum / 16;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -2; k <= 2; k++) {
        sum += horizontal[Math.max(0, Math.min(height - 1, y + k)) * width + x] * kernel[k + 2];
      }
      const index = y * width + x;
      detail[index] = pixels[index] - sum / 16;
    }
  }
  return detail;
}

export function applySharpness(
  pixels: Uint8ClampedArray,
  detail: Float32Array,
  multiplier: number
) {
  const amount = Math.max(0, Math.min(9, multiplier - 1));
  if (!amount) return pixels;
  const result = new Uint8ClampedArray(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    result[i] = pixels[i] + amount * detail[i];
  }
  return result;
}
