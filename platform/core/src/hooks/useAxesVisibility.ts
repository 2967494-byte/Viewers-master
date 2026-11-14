import { useSyncExternalStore } from 'react';
import { getAxesVisible, subscribeAxesVisibility } from '../constants/orbitalAxes';

export default function useAxesVisibility() {
  return useSyncExternalStore(subscribeAxesVisibility, getAxesVisible, getAxesVisible);
}
