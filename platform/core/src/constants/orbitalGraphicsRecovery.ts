/** Recovery UI is separate from fatal errors so the mounted viewer and CPU cache survive. */
export type GraphicsRecoveryPhase = 'idle' | 'waiting' | 'rebuilding';
let phase: GraphicsRecoveryPhase = 'idle';
const listeners = new Set<() => void>();
export const getGraphicsRecovery = () => phase;
export function setGraphicsRecovery(next: GraphicsRecoveryPhase) {
  if (next === phase) return;
  phase = next;
  // A loss can be detected inside a draw; do not synchronously update React there.
  queueMicrotask(() => listeners.forEach(listener => listener()));
}
export function subscribeGraphicsRecovery(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
