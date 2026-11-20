/** Volume pixels stay in Cornerstone's image cache. Drop only the parsed source
 * and file/dataset loader references after a supported single-frame decode.
 * Stack/multiframe consumers can still need that dataset and keep their lifecycle.
 */
export function detachDecodedVolumeSource(image: any, options: any, release: () => void): boolean {
  const data = image?.data;
  if (!options?.additionalDetails?.volumeId || !data ||
      Number(data.string?.('x00280008') || 1) !== 1 ||
      !['1.2.840.10008.1.2.1', '1.2.840.10008.1.2.4.90', '1.2.840.10008.1.2.4.91'].includes(data.string?.('x00020010'))) return false;
  const pixels = image.getPixelData?.();
  if (!ArrayBuffer.isView(pixels) || pixels instanceof DataView) return false;
  const source = data.byteArray;
  delete image.data;
  release();
  if (typeof window !== 'undefined') {
    const stats = ((window as any).__orbitalImageSourceMemory ||= {
      detachedFiles: 0, sourceBytes: 0, independentSourceBytes: 0,
    });
    stats.detachedFiles++;
    stats.sourceBytes += source?.byteLength || 0;
    // An aliasing pixel array may keep the original backing buffer alive.
    // These counters describe dropped references, not measured free RAM.
    if (source?.buffer && source.buffer !== pixels.buffer) stats.independentSourceBytes += source.byteLength;
  }
  return true;
}
