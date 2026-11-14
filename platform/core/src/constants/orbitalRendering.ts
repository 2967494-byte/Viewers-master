export type RenderingPreference = 'auto' | 'compatibility' | 'economy' | 'quality';
const key = 'orbital:rendering-preference:v1';
let preference: RenderingPreference = 'auto';
try {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  if (['compatibility', 'economy', 'quality'].includes(saved)) {
    preference = saved as RenderingPreference;
  }
} catch { /* Storage can be disabled by browser policy. */ }
const listeners = new Set<() => void>();
export const getRenderingPreference = () => preference;
export function setRenderingPreference(value: RenderingPreference) {
  if (value === preference || !['auto', 'compatibility', 'economy', 'quality'].includes(value)) return;
  preference = value;
  try { localStorage.setItem(key, value); } catch { /* Keep working without persistence. */ }
  listeners.forEach(listener => listener());
}
export function subscribeRenderingPreference(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

let graphicsError: string | null = null;
const errorListeners = new Set<() => void>();
export const getGraphicsError = () => graphicsError;
export function reportGraphicsError(message: string) {
  if (message === graphicsError) return;
  graphicsError = message;
  queueMicrotask(() => errorListeners.forEach(listener => listener()));
}
export function subscribeGraphicsError(listener: () => void) {
  errorListeners.add(listener);
  return () => { errorListeners.delete(listener); };
}
