import { CONSTANTS } from '@cornerstonejs/core';
import { Icons } from '@ohif/ui-next';

const { VIEWPORT_PRESETS } = CONSTANTS;

export const DENTAL_VOLUME_PRESET_NAME = 'CT-Dental';

const bonePreset = VIEWPORT_PRESETS.find(preset => preset.name === 'CT-Bone');

if (bonePreset && !VIEWPORT_PRESETS.some(preset => preset.name === DENTAL_VOLUME_PRESET_NAME)) {
  VIEWPORT_PRESETS.push({
    ...bonePreset,
    name: DENTAL_VOLUME_PRESET_NAME,
    // Preserve the bone opacity curve, with warm soft tissue and ivory-white dense bone.
    colorTransfer:
      '24 -3024 0 0 0 -16.4458 0.45 0.20 0.08 250 0.70 0.40 0.20 641.385 0.96 0.94 0.90 1200 1 0.99 0.97 3071 1 1 1',
    ambient: '0.2',
    diffuse: '0.8',
  });
}

if (!Icons[DENTAL_VOLUME_PRESET_NAME]) {
  Icons.addIcon(DENTAL_VOLUME_PRESET_NAME, Icons['CT-Bone']);
}

export default {
  'cornerstone.3dVolumeRendering': {
    volumeRenderingPresets: VIEWPORT_PRESETS,
    volumeRenderingQualityRange: {
      min: 1,
      max: 4,
      step: 1,
    },
  },
};
