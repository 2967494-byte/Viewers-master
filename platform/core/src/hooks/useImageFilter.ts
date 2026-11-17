import { useSyncExternalStore } from 'react';
import { getImageFilter, getRasterImageFilter, getImageFilterStrength, subscribeImageFilter } from '../constants/orbitalImageFilters';

export default function useImageFilter() {
  return useSyncExternalStore(subscribeImageFilter, getImageFilter, getImageFilter);
}

export function useImageFilterStrength() {
  return useSyncExternalStore(subscribeImageFilter, getImageFilterStrength, getImageFilterStrength);
}

export function useRasterImageFilter() {
  return useSyncExternalStore(subscribeImageFilter, getRasterImageFilter, getRasterImageFilter);
}
