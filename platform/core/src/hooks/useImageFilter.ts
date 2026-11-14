import { useSyncExternalStore } from 'react';
import { getImageFilter, subscribeImageFilter } from '../constants/orbitalImageFilters';

export default function useImageFilter() {
  return useSyncExternalStore(subscribeImageFilter, getImageFilter, getImageFilter);
}
