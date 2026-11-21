/** Limits temporary decoding work, never source dimensions or pixel values. */
export function getOrbitalDecodeBudget(
  device: { deviceMemory?: number; hardwareConcurrency?: number } =
    typeof navigator === 'undefined' ? {} : navigator,
  configuredWorkers?: number
) {
  const memory = Number(device.deviceMemory), threads = Number(device.hardwareConcurrency);
  const constrained = (memory > 0 && memory <= 4) || (threads > 0 && threads <= 4);
  const available = Number.isFinite(threads) && threads > 0 ? Math.max(1, Math.floor(threads) - 1) : 2;
  const configured = Number.isFinite(configuredWorkers) && configuredWorkers > 0
    ? Math.max(1, Math.floor(configuredWorkers)) : 2;
  const decoders = Math.min(constrained ? 1 : 2, available, configured);
  // Keep a small download look-ahead so network latency does not idle the decoder.
  return { decoders, pipelines: constrained ? 2 : 4, constrained };
}
