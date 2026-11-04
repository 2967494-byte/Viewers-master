import { annotation } from '@cornerstonejs/tools';

const installed = new WeakSet<object>();

/** A placed implant gets the click before the navigation crosshair underneath it. */
export function installImplantDragPriority(group: any, navigationName: string) {
  const navigation = group.getToolInstance?.(navigationName);
  if (!navigation || installed.has(navigation)) return;
  const previous = navigation.preMouseDownCallback;
  navigation.preMouseDownCallback = evt => {
    if (evt.detail.event?.buttons === 1) {
      const implant = group.getToolInstance('DentalImplant');
      if (implant) {
        const { element, currentPoints } = evt.detail;
        const items = implant.filterInteractableAnnotationsForElement(
          element,
          annotation.state.getAnnotations('DentalImplant', element) || []
        );
        for (const item of [...items].reverse()) {
          if (
            !annotation.visibility.isAnnotationVisible(item.annotationUID) ||
            annotation.locking.isAnnotationLocked(item.annotationUID)
          )
            continue;
          if (!implant.isPointNearTool(element, item, currentPoints.canvas, 6)) continue;
          const handle = implant.getHandleNearImagePoint?.(element, item, currentPoints.canvas, 8);
          annotation.selection.setAnnotationSelected(item.annotationUID);
          if (handle) implant.handleSelectedCallback(evt, item, handle);
          else implant.toolSelectedCallback(evt, item);
          evt.preventDefault();
          return true;
        }
      }
    }
    return previous?.call(navigation, evt) || false;
  };
  installed.add(navigation);
}
