import { expect } from 'vitest';

/**
 * Checks a field edited in place shows its pencil as #95 has it: hidden at
 * rest, showing while the pointer is over the field or it has keyboard
 * focus, faint on touch screens, and the whole field tinted on hover.
 * jsdom applies no styles, so this reads the classes that do it.
 */
export function expectPencilOnHoverAndFocus(field: Element) {
  expect(field).toHaveClass('group/edit', 'hover:bg-white/10');
  const pencil = field.querySelector('[data-edit-pencil]');
  expect(pencil).not.toBeNull();
  expect(pencil).toHaveClass(
    'text-white/0',
    'group-hover/edit:text-white/60',
    'group-focus-visible/edit:text-white/60',
    'pointer-coarse:text-white/40',
  );
}
