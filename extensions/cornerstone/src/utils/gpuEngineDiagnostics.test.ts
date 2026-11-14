import { installGpuContextDiagnostics, installGpuEngineDiagnostics } from './gpuEngineDiagnostics';
import { beginGpuDiagnosticSession, GPU_DIAGNOSTIC_PROFILE_KEY, GPU_DIAGNOSTIC_REPORT_KEY } from '@ohif/core/src/constants/orbitalGpuDiagnostics';

const events = () => JSON.parse(localStorage.getItem(GPU_DIAGNOSTIC_REPORT_KEY)).events;
beforeEach(() => {
  localStorage.setItem(GPU_DIAGNOSTIC_PROFILE_KEY, '64'); beginGpuDiagnosticSession();
  jest.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => { localStorage.removeItem(GPU_DIAGNOSTIC_PROFILE_KEY); beginGpuDiagnosticSession(); jest.restoreAllMocks(); });

it('leaves native APIs unchanged without explicit diagnostics', () => {
  localStorage.removeItem(GPU_DIAGNOSTIC_PROFILE_KEY); beginGpuDiagnosticSession();
  const gl = { texImage2D: jest.fn() }; const original = gl.texImage2D;
  installGpuContextDiagnostics(gl); expect(gl.texImage2D).toBe(original);
});

it('preserves GL receiver, parameters, result and error state without exposing payload', () => {
  const pixels = new Uint8Array([17, 19, 23]);
  const original = jest.fn(function () { expect(this).toBe(gl); return 42; });
  const gl: any = { texImage2D: original, isContextLost: () => false, getError: jest.fn(), finish: jest.fn() };
  installGpuContextDiagnostics(gl); installGpuContextDiagnostics(gl);
  expect(gl.texImage2D(3553, 0, 6408, 1024, 2, 0, 6408, 5121, pixels)).toBe(42);
  expect(original).toHaveBeenCalledTimes(1);
  expect(original.mock.calls[0][8]).toBe(pixels);
  expect(gl.getError).not.toHaveBeenCalled(); expect(gl.finish).not.toHaveBeenCalled();
  expect(events().find(event => event.stage === 'gl-call-start')).toEqual(expect.objectContaining({
    operation: 'texImage2D', width: 1024, height: 2, internalFormat: 6408 }));
  expect(JSON.stringify(events())).not.toContain('[17,19,23]');
});

it('rethrows the original native exception and limits repeated draw logging', () => {
  const error = new TypeError('native');
  const gl: any = { drawArrays: jest.fn(), compileShader: () => { throw error; } };
  installGpuContextDiagnostics(gl);
  for (let index = 0; index < 50; index++) gl.drawArrays(4, 0, 3);
  expect(events().filter(event => event.stage === 'gl-call-start' && event.operation === 'drawArrays')).toHaveLength(12);
  expect(() => gl.compileShader({})).toThrow(error);
  expect(events().at(-1)).toEqual(expect.objectContaining({ stage: 'gl-call-threw', operation: 'compileShader' }));
});

it('records viewport size and mapper settings while preserving engine receiver and return value', () => {
  const original = jest.fn(function () { expect(this).toBe(engine); return 'frame'; });
  const engine: any = { contextPool: { getAllContexts: () => [] }, renderViewportUsingCustomOrVtkPipeline: original };
  const viewport = { type: 'orthographic', canvas: { width: 720, height: 400 }, getSlabThickness: () => .1,
    getActors: () => [{ actor: { getMapper: () => ({ getSampleDistance: () => .1, getMaximumSamplesPerRay: () => 4000 }) } }] };
  installGpuEngineDiagnostics(engine); installGpuEngineDiagnostics(engine);
  expect(engine.renderViewportUsingCustomOrVtkPipeline(viewport)).toBe('frame');
  expect(original).toHaveBeenCalledTimes(1);
  expect(events().find(event => event.stage === 'viewport-render-start')).toEqual(expect.objectContaining({
    canvas: [720, 400], slabThickness: .1, mappers: [{ sampleDistance: .1, maximumSamplesPerRay: 4000 }] }));
});
