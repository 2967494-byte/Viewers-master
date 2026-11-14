import installHiddenPanoramaRenderGuard from './hiddenPanoramaRenderGuard';

function setup() {
  const wrapper = document.createElement('div'); wrapper.className = 'viewport-wrapper';
  const element = document.createElement('div'); wrapper.append(element);
  const pane = document.createElement('div'); pane.className = 'automatic-panorama-pane'; wrapper.append(pane);
  const original = jest.fn(function (...args) { expect(this).toBe(engine); return { frame: args[0].id }; });
  const engine = { renderViewportUsingCustomOrVtkPipeline: original };
  const viewport = { id: 'mpr-3d', element };
  installHiddenPanoramaRenderGuard(engine); installHiddenPanoramaRenderGuard(engine);
  return { wrapper, element, pane, original, engine, viewport };
}

it('does not ray-cast a covered skull or emit a rendered-frame event', () => {
  const { engine, viewport, original } = setup();
  for (let index = 0; index < 5; index++) expect(engine.renderViewportUsingCustomOrVtkPipeline(viewport)).toBeUndefined();
  expect(original).not.toHaveBeenCalled();
});

it('resumes the same renderer when the panorama is removed and suspends again on return', () => {
  const { wrapper, pane, engine, viewport, original } = setup();
  pane.remove();
  expect(engine.renderViewportUsingCustomOrVtkPipeline(viewport)).toEqual({ frame: 'mpr-3d' });
  expect(original).toHaveBeenCalledTimes(1);
  wrapper.append(pane); engine.renderViewportUsingCustomOrVtkPipeline(viewport);
  expect(original).toHaveBeenCalledTimes(1);
});

it('keeps all other viewports and layouts rendering with original arguments', () => {
  const { engine, viewport, original, wrapper } = setup();
  viewport.id = 'mpr-axial'; engine.renderViewportUsingCustomOrVtkPipeline(viewport, 'argument');
  expect(original).toHaveBeenLastCalledWith(viewport, 'argument');
  viewport.id = 'mpr-3d'; wrapper.className = 'other-layout'; engine.renderViewportUsingCustomOrVtkPipeline(viewport);
  expect(original).toHaveBeenCalledTimes(2);
});
