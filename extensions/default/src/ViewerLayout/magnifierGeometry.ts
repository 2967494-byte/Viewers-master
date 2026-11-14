/** Convert a screen-sized lens into source pixels, including panorama letterboxing and HiDPI. */
export function magnifierCrop(
  source: { width: number; height: number },
  bounds: { left: number; top: number; width: number; height: number },
  point: { x: number; y: number },
  zoom: number,
  diameter: number,
  contain: boolean
) {
  if (![source.width, source.height, bounds.width, bounds.height, zoom, diameter]
    .every(value => Number.isFinite(value) && value > 0)) return null;
  const scale = Math.min(bounds.width / source.width, bounds.height / source.height);
  const width = contain ? source.width * scale : bounds.width;
  const height = contain ? source.height * scale : bounds.height;
  const x = point.x - bounds.left - (bounds.width - width) / 2;
  const y = point.y - bounds.top - (bounds.height - height) / 2;
  if (x < 0 || y < 0 || x > width || y > height) return null;
  const sw = diameter / zoom * source.width / width;
  const sh = diameter / zoom * source.height / height;
  return { sx: x * source.width / width - sw / 2, sy: y * source.height / height - sh / 2, sw, sh };
}
