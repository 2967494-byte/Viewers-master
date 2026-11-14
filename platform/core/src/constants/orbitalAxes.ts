// Visibility is independent from Crosshairs tool activation and the physical MPR point.
let visible = true;
const listeners = new Set<() => void>();

export const getAxesVisible = () => visible;
export function setAxesVisible(value: boolean) {
  if (visible === value) return;
  visible = value;
  listeners.forEach(listener => listener());
}
export function subscribeAxesVisibility(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
