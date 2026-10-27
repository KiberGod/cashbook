import { KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type DraggableAttributes, type DraggableSyntheticListeners } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { MouseEvent } from 'react';

/** Drag starts after a small move (mouse) or a long press (touch), so clicks and scrolling still work. */
export function useDragSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] } }),
  );
}

/** The click that follows a drop must not open the card under it (dnd-kit only stops its propagation). */
export function swallowNextClick() {
  const cancel = (e: globalThis.MouseEvent) => e.preventDefault();
  window.addEventListener('click', cancel, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', cancel, { capture: true }), 300);
}

/** Props that make a link card its own drag handle; while sorting is off it stays a plain link. */
export function dragHandle(enabled: boolean, attributes: DraggableAttributes, listeners: DraggableSyntheticListeners) {
  return {
    draggable: false,
    // a long press starts dragging on touch screens, not the link menu
    onContextMenu: (e: MouseEvent) => {
      if ((e.nativeEvent as PointerEvent).pointerType === 'touch') e.preventDefault();
    },
    'aria-roledescription': enabled ? attributes['aria-roledescription'] : undefined,
    'aria-describedby': enabled ? attributes['aria-describedby'] : undefined,
    ...listeners,
  };
}
