import { IMPLANT_DATA, type ImplantModel } from './implantData';

export const ALL_IMPLANT_MODELS = IMPLANT_DATA.flatMap(brand =>
  brand.lines.flatMap(line => line.models)
);
const knownIds = new Set(ALL_IMPLANT_MODELS.map(model => model.id));
const endpoint = '/api/viewer/implant-favorites';

export function validFavoriteIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string' && knownIds.has(id)))]
    : [];
}

export type ImplantFavoritesSnapshot = {
  accountKey: string;
  favoriteIds: string[];
  csrfToken: string;
};

export class ImplantFavoritesError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

async function requestFavorites(init?: RequestInit): Promise<ImplantFavoritesSnapshot> {
  const response = await fetch(endpoint, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ImplantFavoritesError(
        'unauthorized',
        'Для избранного откройте просмотрщик из личного кабинета с доступом к ORBITAL 3D.'
      );
    }
    const error = await response.json().catch(() => ({}));
    if (error.error === 'account_changed') {
      throw new ImplantFavoritesError(
        'account_changed',
        'Учётная запись изменилась. Загрузите избранное заново.'
      );
    }
    throw new ImplantFavoritesError(
      'unavailable',
      'Не удалось связаться с избранным в личном кабинете. Изменение не подтверждено.'
    );
  }
  const value = await response.json();
  if (
    !value ||
    typeof value.accountKey !== 'string' ||
    !/^\d+:\d+$/.test(value.accountKey) ||
    !Array.isArray(value.favoriteIds) ||
    typeof value.csrfToken !== 'string' ||
    !value.csrfToken
  ) {
    throw new ImplantFavoritesError(
      'invalid_response',
      'Сервер избранного вернул некорректный ответ.'
    );
  }
  return {
    accountKey: value.accountKey,
    csrfToken: value.csrfToken,
    favoriteIds: validFavoriteIds(value.favoriteIds),
  };
}

export function loadImplantFavorites(): Promise<ImplantFavoritesSnapshot> {
  return requestFavorites();
}

export async function setImplantFavorite(
  context: ImplantFavoritesSnapshot,
  modelId: string,
  favorite: boolean
): Promise<ImplantFavoritesSnapshot> {
  const snapshot = await requestFavorites({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': context.csrfToken },
    body: JSON.stringify({ accountKey: context.accountKey, modelId, favorite }),
  });
  if (snapshot.accountKey !== context.accountKey) {
    throw new ImplantFavoritesError(
      'account_changed',
      'Учётная запись изменилась. Загрузите избранное заново.'
    );
  }
  return snapshot;
}

/** Keep catalogue order within each group and never mutate the source list. */
export function favoritesFirst(models: ImplantModel[], favoriteIds: string[]): ImplantModel[] {
  const favorites = new Set(favoriteIds);
  return [
    ...models.filter(model => favorites.has(model.id)),
    ...models.filter(model => !favorites.has(model.id)),
  ];
}
