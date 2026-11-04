import React from 'react';
import { act, render } from '@testing-library/react';
import { cache, eventTarget, EVENTS } from '@cornerstonejs/core';
import { useSystem } from '@ohif/core';
import LoadingProgressBar from './LoadingProgressBar';

jest.mock('@cornerstonejs/core', () => ({
  cache: { getImage: jest.fn(), getVolume: jest.fn() },
  eventTarget: new EventTarget(),
  EVENTS: { IMAGE_LOADED: 'loaded', IMAGE_VOLUME_LOADING_COMPLETED: 'complete', IMAGE_VOLUME_MODIFIED: 'modified', IMAGE_LOAD_FAILED: 'failed' },
  Enums: { ImageQualityStatus: { FULL_RESOLUTION: 8 } },
}));
jest.mock('@ohif/core', () => ({ useSystem: jest.fn() }));

describe('Loading along the viewport boundary', () => {
  beforeEach(() => jest.clearAllMocks());
  const setup = () => {
    let sets = [
      {
        displaySetInstanceUID: 'a',
        numImageFrames: 2,
        images: [{ imageId: '1' }, { imageId: '2' }],
      },
    ];
    const callbacks = new Map<string, () => void>();
    const displaySetService = {
      getActiveDisplaySets: () => sets,
      EVENTS: { DISPLAY_SETS_ADDED: 'added', ACTIVE_DISPLAY_SETS_CHANGED: 'changed' },
      subscribe: (event, callback) => {
        callbacks.set(event, callback);
        return { unsubscribe: jest.fn() };
      },
    };
    (useSystem as jest.Mock).mockReturnValue({
      servicesManager: { services: { displaySetService } },
    });
    return {
      callbacks,
      replace: value => {
        sets = value;
        callbacks.get('changed')();
      },
    };
  };
  const loaded = id =>
    act(() =>
      eventTarget.dispatchEvent(
        new CustomEvent(EVENTS.IMAGE_LOADED, { detail: { image: { imageId: id } } })
      )
    );
  it('counts unique active images and completes only after all frames', () => {
    setup();
    const view = render(React.createElement(LoadingProgressBar));
    expect(view.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
    loaded('unrelated');
    loaded('1');
    loaded('1');
    expect(view.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
    expect(view.container.querySelector('.orbital-load-front').getAttribute('style')).toContain(
      '50%'
    );
    loaded('2');
    expect(view.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
    expect(view.container.querySelector('.is-done')).toBeTruthy();
  });
  it('resets for another study and does not count completion of an unrelated volume', () => {
    const service = setup();
    const view = render(React.createElement(LoadingProgressBar));
    loaded('1');
    loaded('2');
    act(() =>
      service.replace([
        { displaySetInstanceUID: 'b', numImageFrames: 1, images: [{ imageId: '3' }] },
      ])
    );
    expect(view.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
    (cache.getVolume as jest.Mock).mockReturnValue({ imageIds: ['1', '2'] });
    act(() =>
      eventTarget.dispatchEvent(
        new CustomEvent(EVENTS.IMAGE_VOLUME_LOADING_COMPLETED, { detail: { volumeId: 'old' } })
      )
    );
    expect(view.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
    loaded('3');
    expect(view.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });
  it('counts volume frames during download and never treats failed frames as complete', () => {
    setup();
    const view = render(React.createElement(LoadingProgressBar));
    (cache.getVolume as jest.Mock).mockReturnValue({ imageIds: ['1', '2'], cachedFrames: [8] });
    act(() => eventTarget.dispatchEvent(new CustomEvent(EVENTS.IMAGE_VOLUME_MODIFIED, { detail: { volumeId: 'v' } })));
    expect(view.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
    act(() => eventTarget.dispatchEvent(new CustomEvent(EVENTS.IMAGE_LOAD_FAILED, { detail: { imageId: '2' } })));
    act(() => eventTarget.dispatchEvent(new CustomEvent(EVENTS.IMAGE_VOLUME_LOADING_COMPLETED, { detail: { volumeId: 'v' } })));
    expect(view.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
    expect(view.getByRole('progressbar').getAttribute('aria-valuetext')).toContain('ошибок: 1');
    loaded('2');
    expect(view.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
    expect(view.getByRole('progressbar').getAttribute('aria-valuetext')).not.toContain('ошибок');
  });
  it('excludes series that are not displayed in any viewport', () => {
    const service = setup();
    // Read the configured system without replacing its existing display-set service.
    const configured = (useSystem as jest.Mock)();
    configured.servicesManager.services.viewportGridService = {
      getState: () => ({ viewports: new Map([['mpr', { displaySetInstanceUIDs: ['a'] }]]) }),
    };
    const view = render(React.createElement(LoadingProgressBar));
    act(() => service.replace([
      { displaySetInstanceUID: 'a', numImageFrames: 1, images: [{ imageId: '1' }] },
      { displaySetInstanceUID: 'unused', numImageFrames: 200, images: [{ imageId: 'unused' }] },
    ]));
    loaded('1');
    expect(view.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
    expect(view.getByRole('progressbar').getAttribute('aria-valuetext')).toContain('1 из 1');
  });
});
