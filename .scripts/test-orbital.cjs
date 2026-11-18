#!/usr/bin/env node

// Focused regression checks for the ORBITAL additions to this OHIF fork.
// Run from any directory: node .scripts/test-orbital.cjs [extra Jest options].
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tests = new Set();
const add = relative => {
  const file = path.join(root, relative);
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Missing ORBITAL regression test: ${relative}`);
  }
  tests.add(file);
};
const addDirectory = relative => {
  const dir = path.join(root, relative);
  for (const name of fs.readdirSync(dir).sort()) {
    if (/\.test\.[jt]sx?$/.test(name)) add(`${relative}/${name}`);
  }
};

addDirectory('extensions/cornerstone/src/components/ManualPanorama');
addDirectory('extensions/cornerstone/src/components/ImplantLibrary');
add('extensions/cornerstone/src/utils/guardImageFilterPass.test.ts');
for (const name of ['DentalCrosshairsTool', 'dentalCrosshairHandles', 'DentalImplantTool', 'DentalMeasurementTools', 'dentalGeometry', 'implantGeometry']) {
  add(`extensions/cornerstone/src/tools/${name}.test.ts`);
}
for (const name of ['dentalToolControls', 'crosshairSlabControls', 'viewportImageFilter', 'implantDragPriority', 'intersectVolumePlane', 'mprFocusLayout', 'largeVolumeTexture', 'adaptiveVolumeTexture', 'graphicsContextRecovery', 'adaptiveVolumeRecovery', 'automaticGpuProfile', 'gpuStartupProfile', 'gpuDiagnosticProfile', 'gpuEngineDiagnostics', 'hiddenPanoramaRenderGuard', 'viewerOpenTelemetry', 'viewerDiagnostics', 'zoomMprViewport', 'preserveMprResize']) {
  add(`extensions/cornerstone/src/utils/${name}.test.ts`);
}
add('extensions/cornerstone/src/Viewport/Overlays/VolumeSliceIndicator.test.ts');
for (const name of ['DentalToolsToolbar', 'RenderingModeControl', 'LoadingProgressBar', 'magnifierGeometry']) {
  add(`extensions/default/src/ViewerLayout/${name}.test.ts`);
}
for (const name of ['S3FileService', 'orbitalS3ImageLoader', 's3CompressedStudy', 's3MetadataIndex', 'useS3Loader', 'viewerLaunch', 'volumeRenderingSupport']) {
  add(`platform/app/src/utils/${name}.test.ts`);
}
add('platform/app/src/routes/Local/__tests__/readDicomMetadataFast.test.js');
add('platform/app/src/components/ViewportGrid.test.ts');
add('platform/app/src/components/GraphicsRecoveryBoundary.test.ts');

console.log(`ORBITAL: running ${tests.size} regression suites.`);
const result = spawnSync(process.execPath, [
  path.join(root, 'node_modules/jest/bin/jest.js'),
  '--config', path.join(root, 'jest.config.js'),
  '--runInBand', '--coverage=false', '--runTestsByPath',
  ...tests,
  ...process.argv.slice(2),
], { cwd: root, stdio: 'inherit' });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
