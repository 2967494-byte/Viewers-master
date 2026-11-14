export const IMAGE_FILTER_OPTIONS = [
  { id: 'none', title: 'Без фильтра', help: 'Обычное отображение всех 2D-окон.' },
  { id: 'smooth', title: '2D Smooth — сглаживание', help: 'Смягчает мелкий шум и границы пикселей.' },
  { id: 'sharpen', title: '2D Sharpen — резкость', help: 'Подчёркивает контуры на изображении.' },
  { id: 'unsharp', title: '2D Unsharpen — нерезкая маска', help: 'Усиливает локальный контраст мелких деталей.' },
] as const;
export type ImageFilterMode = typeof IMAGE_FILTER_OPTIONS[number]['id'];
let mode: ImageFilterMode = 'none';
const listeners = new Set<() => void>();
export const getImageFilter = () => mode;
export function setImageFilter(value: ImageFilterMode) {
  if (value === mode || !IMAGE_FILTER_OPTIONS.some(option => option.id === value)) return;
  mode = value;
  listeners.forEach(listener => listener());
}
export function subscribeImageFilter(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Display-space kernels. A fixed 5x5 size lets the GPU reuse its shader and framebuffer. */
export function imageFilterKernel(value: ImageFilterMode): number[] | null {
  if (value === 'none') return null;
  const kernel = Array<number>(25).fill(0);
  if (value === 'smooth') {
    const weights = [1, 2, 1];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++)
      kernel[(y + 1) * 5 + x + 1] = weights[x] * weights[y] / 16;
  } else if (value === 'sharpen') {
    kernel[12] = 2;
    for (const index of [7, 11, 13, 17]) kernel[index] = -0.25;
  } else if (value === 'unsharp') {
    const weights = [1, 4, 6, 4, 1], amount = 0.8;
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++)
      kernel[y * 5 + x] = -amount * weights[x] * weights[y] / 256;
    kernel[12] += 1 + amount;
  }
  return kernel;
}

/** Panorama equivalent of the GPU convolution; input pixels and DICOM data stay intact. */
export function filterImagePixels(pixels: Uint8ClampedArray, width: number, height: number, value: ImageFilterMode) {
  const kernel = imageFilterKernel(value);
  if (!kernel) return pixels;
  const taps = kernel.map((weight, i) => ({ weight, x: i % 5 - 2, y: Math.floor(i / 5) - 2 }))
    .filter(tap => tap.weight !== 0);
  const output = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let result = 0;
    for (const tap of taps) {
      const row = Math.max(0, Math.min(height - 1, y + tap.y));
      const column = Math.max(0, Math.min(width - 1, x + tap.x));
      result += pixels[row * width + column] * tap.weight;
    }
    output[y * width + x] = result;
  }
  return output;
}
