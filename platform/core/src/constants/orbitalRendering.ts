import { recordViewerEvent } from './orbitalViewerDiagnostics';
export type RenderingPreference = 'auto' | 'compatibility' | 'economy' | 'quality';
const key = 'orbital:rendering-preference:v1';
let preference: RenderingPreference = 'auto';
try {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  if (['compatibility', 'economy', 'quality'].includes(saved)) {
    preference = saved === 'economy' ? 'compatibility' : saved as RenderingPreference;
    if (saved === 'economy') localStorage.setItem(key, preference);
  }
} catch { /* Storage can be disabled by browser policy. */ }
const listeners = new Set<() => void>();
export const getRenderingPreference = () => preference;
export function setRenderingPreference(value: RenderingPreference) {
  if (value === 'economy') value = 'compatibility'; // Migrate calls from older cached UI code as well.
  if (value === preference || !['auto', 'compatibility', 'economy', 'quality'].includes(value)) return;
  preference = value;
  recordViewerEvent('mode', { value });
  try { localStorage.setItem(key, value); } catch { /* Keep working without persistence. */ }
  listeners.forEach(listener => listener());
}

/** A rejected manual profile must not trap the next opening in the same failure. */
export function forgetFailedRenderingPreference() {
  try { localStorage.removeItem(key); } catch { /* optional storage */ }
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
