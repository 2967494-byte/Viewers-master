import {
  ALL_IMPLANT_MODELS,
  favoritesFirst,
  loadImplantFavorites,
  setImplantFavorite,
  validFavoriteIds,
} from './implantFavorites';

describe('Account-owned implant favorites', () => {
  const state = { accountKey: '12:0', favoriteIds: ['SOFX483810S'], csrfToken: 'csrf-test' };
  afterEach(() => jest.restoreAllMocks());

  it('accepts only known unique catalogue IDs', () => {
    expect(validFavoriteIds(['SOFX483810S', 'BLT-3.3-10', 'SOFX483810S', 'unknown', 42])).toEqual([
      'SOFX483810S',
      'BLT-3.3-10',
    ]);
    expect(validFavoriteIds({})).toEqual([]);
  });

  it('puts favorites first across brands without changing catalogue order', () => {
    const ids = ['BLT-3.3-8', 'BLT-3.3-10', 'SOFX483810S'];
    const input = ids.map(id => ALL_IMPLANT_MODELS.find(model => model.id === id));
    expect(favoritesFirst(input, ['SOFX483810S', 'BLT-3.3-10']).map(model => model.id)).toEqual([
      'BLT-3.3-10',
      'SOFX483810S',
      'BLT-3.3-8',
    ]);
    expect(input.map(model => model.id)).toEqual(ids);
  });

  it('uses the CRM session and CSRF, submits one intent and never a chosen owner', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => state });
    expect(await loadImplantFavorites()).toEqual(state);
    expect(fetch).toHaveBeenLastCalledWith('/api/viewer/implant-favorites', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    await setImplantFavorite(state, 'SOFX483810S', true);
    const init = (fetch as jest.Mock).mock.calls[1][1];
    expect(init.headers['X-CSRFToken']).toBe('csrf-test');
    expect(JSON.parse(init.body)).toEqual({
      accountKey: '12:0',
      modelId: 'SOFX483810S',
      favorite: true,
    });
  });

  it('rejects account changes, failed saves and invalid server responses', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ...state, accountKey: '99:0' }) });
    await expect(setImplantFavorite(state, 'SOFX483810S', true)).rejects.toMatchObject({
      code: 'account_changed',
    });
    (fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'account_changed' }),
    });
    await expect(setImplantFavorite(state, 'SOFX483810S', true)).rejects.toMatchObject({
      code: 'account_changed',
    });
    (fetch as jest.Mock).mockResolvedValue({ ok: false, status: 401 });
    await expect(loadImplantFavorites()).rejects.toMatchObject({ code: 'unauthorized' });
    (fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ favoriteIds: [] }) });
    await expect(loadImplantFavorites()).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
