import { installImplantDragPriority } from './implantDragPriority';

export const DENTAL_TOOL_NAMES = {
  pan: 'Pan',
  length2d: 'DentalLength2D',
  length3d: 'DentalLength3D',
  tapeLine: 'DentalTapeLine',
  tapeCurve: 'DentalTapeCurve',
  angle2d: 'Angle',
  angle3d: 'DentalAngle3D',
  canal: 'DentalCanal',
  implant: 'DentalImplant',
  magnify: 'DentalMagnify',
};

/** Change only the primary mouse binding; preserve wheel, middle-button pan and right-button zoom. */
export function activateDentalTool(
  groups: any[],
  tool: string,
  implant?: unknown,
  onPlaced?: () => void
) {
  if (tool !== 'navigate' && !DENTAL_TOOL_NAMES[tool]) return false;
  const planar = tool === 'length2d' || tool === 'angle2d' || tool === 'implant';
  if (!groups.some(group => group.id === 'mpr')) return false;
  for (const group of groups.filter(g => g.id === 'mpr' || g.id === 'mpr-3d')) {
    const name =
      tool === 'navigate' || (planar && group.id === 'mpr-3d')
        ? group.id === 'mpr-3d'
          ? 'TrackballRotate'
          : 'Crosshairs'
        : DENTAL_TOOL_NAMES[tool];
    if (!group.hasTool(name)) continue;
    if (name === 'Crosshairs' || name === 'TrackballRotate')
      installImplantDragPriority(group, name);
    const active = group.getActivePrimaryMouseButtonTool();
    if (active && active !== name) group.setToolPassive(active);
    if (tool === 'implant' && implant && group.id === 'mpr')
      group.setToolConfiguration(name, { implant, ...(onPlaced ? { onPlaced } : {}) });
    if (name === 'Pan') {
      const pan = group.getToolInstance?.(name);
      if (pan) {
        // The hand moves the image even over a passive implant or measurement.
        // Pan's drag dispatcher still runs; only annotation selection is skipped.
        pan.preMouseDownCallback = event => { event.preventDefault(); return true; };
      }
    }
    group.setToolActive(name, { bindings: [{ mouseButton: 1 }] });
  }
  return true;
}
