import { useEffect, useRef, useState } from 'react';
import {
  ImplantFavoritesError,
  ImplantFavoritesSnapshot,
  loadImplantFavorites,
  setImplantFavorite,
} from './implantFavorites';

/** Server is authoritative. No shared localStorage that could leak another doctor's list. */
export function useImplantFavorites() {
  const [snapshot, setSnapshot] = useState<ImplantFavoritesSnapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const mounted = useRef(false);
  const writing = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    setSnapshot(null);
    setBusy(true);
    setError('');
    loadImplantFavorites()
      .then(value => {
        if (!cancelled) setSnapshot(value);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            'Избранное недоступно. Откройте просмотрщик из личного кабинета или повторите загрузку.'
          );
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [revision]);

  const toggle = async (modelId: string) => {
    if (!snapshot || busy || writing.current) return;
    writing.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await setImplantFavorite(
        snapshot,
        modelId,
        !snapshot.favoriteIds.includes(modelId)
      );
      if (mounted.current) setSnapshot(result);
    } catch (reason) {
      if (mounted.current) {
        // A lost response may already have committed: require a fresh read before editing.
        setSnapshot(null);
        setError(
          reason instanceof ImplantFavoritesError
            ? reason.message
            : 'Не удалось сохранить избранное. Повторите загрузку, чтобы проверить состояние на сервере.'
        );
      }
    } finally {
      writing.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return {
    favoriteIds: snapshot?.favoriteIds || [],
    busy,
    ready: snapshot !== null,
    error,
    toggle,
    reload: () => setRevision(value => value + 1),
  };
}
