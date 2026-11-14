/** EZ-style plane colors, shared by MPR and panorama reference lines. */
export const ORBITAL_MPR_COLORS = {
  axial: '#00c800',
  sagittal: '#e88000',
  coronal: '#e0df00',
} as const;

export const ORBITAL_OVERLAY_COLOR = '#b4beca';

export const ORBITAL_MAGNIFICATIONS = [2, 3, 4, 6] as const;
export function normalizeMagnification(value: number): number {
  return ORBITAL_MAGNIFICATIONS.some(zoom => zoom === value) ? value : 3;
}
