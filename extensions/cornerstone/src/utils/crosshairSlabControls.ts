import { Enums, getEnabledElement } from '@cornerstonejs/core';
import { Enums as ToolEnums, ToolGroupManager, state } from '@cornerstonejs/tools';
import { getAxesVisible } from '@ohif/core/src/constants/orbitalAxes';
import type DentalCrosshairsTool from '../tools/DentalCrosshairsTool';

function activeCrosshairs(element): DentalCrosshairsTool | undefined {
  const enabled = getEnabledElement(element);
  if (enabled?.viewport.type !== Enums.ViewportType.ORTHOGRAPHIC) return;
  const group = ToolGroupManager.getToolGroupForViewport(enabled.viewportId, enabled.renderingEngineId);
  if (group?.getActivePrimaryMouseButtonTool() !== 'Crosshairs') return;
  return group.getToolInstance('Crosshairs') as DentalCrosshairsTool;
}

/** Intercept only slab grips, before Cornerstone's ordinary wheel slice scrolling. */
export default function installCrosshairSlabControls(element: HTMLElement, resolveTool = activeCrosshairs) {
  let wheelTarget: { tool: any; target: any; x: number; y: number };
  let hoverTool: any;
  let press: { tool: any; target: any; x: number; y: number; dragged: boolean; intercept: boolean;
    mouseDown?: MouseEvent; mouseUp?: MouseEvent };
  const consumedEvents = new WeakSet<Event>();
  const canvasPoint = (event: MouseEvent) => {
    const rect = element.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  const interactive = event => getAxesVisible() && !event.ctrlKey && !event.altKey &&
    !event.metaKey && !event.shiftKey && !event.target?.closest?.('button,input,select,textarea,a');
  const move = (event: PointerEvent) => {
    const tool = interactive(event) ? resolveTool(element) : undefined;
    if (hoverTool && hoverTool !== tool) hoverTool.updateDentalHover?.(element, null);
    hoverTool = tool;
    tool?.updateDentalHover?.(element, canvasPoint(event));
    if (wheelTarget && Math.hypot(event.clientX - wheelTarget.x, event.clientY - wheelTarget.y) > 10 &&
      tool?.getSlabWheelTarget?.(element, canvasPoint(event))?.id !== wheelTarget.target.id)
      wheelTarget = undefined;
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) press.dragged = true;
  };
  const wheel = (event: WheelEvent) => {
    if (!interactive(event) || event.buttons || state.isInteractingWithTool || !event.deltaY) return;
    const tool = resolveTool(element);
    if (!tool?.getSlabHandleAtPoint) return;
    // Allow ordinary mouse jitter and continuing along the fixed reference axis,
    // instead of requiring the pointer to chase the expanding slab boundary.
    const previous = wheelTarget?.tool === tool &&
      Math.hypot(event.clientX - wheelTarget.x, event.clientY - wheelTarget.y) <= 10 ? wheelTarget : null;
    const target = tool.getSlabWheelTarget?.(element, canvasPoint(event)) || previous?.target ||
      tool.getSlabHandleAtPoint(element, canvasPoint(event))?.target;
    if (!target || !tool.changeSlabThickness(target, -Math.sign(event.deltaY))) {
      wheelTarget = undefined;
      return;
    }
    if (!previous || previous.target !== target)
      wheelTarget = { tool, target, x: event.clientX, y: event.clientY };
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const down = (event: PointerEvent) => {
    press = undefined;
    const previous = wheelTarget;
    wheelTarget = undefined;
    if (event.button !== 0 || !interactive(event)) return;
    const tool = resolveTool(element);
    const handle = tool?.getSlabHandleAtPoint?.(element, canvasPoint(event));
    const latched = previous && previous.tool === tool &&
      (Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 10 ||
        tool?.getSlabWheelTarget?.(element, canvasPoint(event))?.id === previous.target.id) ? previous.target : null;
    const target = handle?.target || latched;
    if (target) press = { tool, target, x: event.clientX, y: event.clientY, dragged: false, intercept: !handle };
  };
  // A wheel-adjusted boundary can move away from the stationary pointer. Clicking
  // at that same position still resets the slab and must not jump the crosshair.
  const mouseDown = (event: MouseEvent) => {
    if (press && event.button === 0) press.mouseDown = event;
    if (press?.intercept && event.button === 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const mouseUp = (event: MouseEvent) => {
    if (press && event.button === 0) press.mouseUp = event;
  };
  // Cornerstone defers short mouse gestures for double-click detection (400 ms).
  // After reset the grip is elsewhere, so replaying that down would jump to the
  // background. Consume the original gesture at its delayed tool dispatch too.
  const delayedMouseEvent = (event: CustomEvent) => {
    if (event.detail?.event && consumedEvents.has(event.detail.event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const click = (event: MouseEvent) => {
    const candidate = press;
    press = undefined;
    if (!candidate || candidate.dragged || event.button !== 0 || !interactive(event) ||
      Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) > 4 ||
      resolveTool(element) !== candidate.tool) return;
    if (candidate.tool.changeSlabThickness(candidate.target, 'reset')) {
      if (candidate.mouseDown) consumedEvents.add(candidate.mouseDown);
      if (candidate.mouseUp) consumedEvents.add(candidate.mouseUp);
      wheelTarget = undefined;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const leave = () => {
    wheelTarget = undefined; press = undefined;
    hoverTool?.updateDentalHover?.(element, null);
    hoverTool = undefined;
  };
  element.addEventListener('wheel', wheel, { capture: true, passive: false });
  element.addEventListener('pointerdown', down, true);
  element.addEventListener('mousedown', mouseDown, true);
  element.addEventListener('mouseup', mouseUp, true);
  element.addEventListener('pointermove', move, true);
  element.addEventListener('click', click, true);
  element.addEventListener('pointerleave', leave);
  element.addEventListener('pointercancel', leave);
  const delayedEvents = [ToolEnums.Events.MOUSE_DOWN, ToolEnums.Events.MOUSE_DOWN_ACTIVATE,
    ToolEnums.Events.MOUSE_CLICK, ToolEnums.Events.MOUSE_UP];
  delayedEvents.forEach(name => element.addEventListener(name, delayedMouseEvent, true));
  return () => {
    leave();
    element.removeEventListener('wheel', wheel, true);
    element.removeEventListener('pointerdown', down, true);
    element.removeEventListener('mousedown', mouseDown, true);
    element.removeEventListener('mouseup', mouseUp, true);
    element.removeEventListener('pointermove', move, true);
    element.removeEventListener('click', click, true);
    element.removeEventListener('pointerleave', leave);
    element.removeEventListener('pointercancel', leave);
    delayedEvents.forEach(name => element.removeEventListener(name, delayedMouseEvent, true));
  };
}
