/*
 * A field edited in place shows it can be edited without a pencil at rest
 * (#95): its text stands alone, the whole field tinted on hover, and its
 * pencil shows only while the pointer is over the field or it has keyboard
 * focus. Touch screens, which have no hover, show the pencil faintly at
 * rest, as the tile actions do. An empty field's italic placeholder says so
 * too.
 */

/** The field, which the pencil inside it follows. */
export const EDIT_FIELD =
  'group/edit rounded transition-colors hover:bg-white/10';

/** The field's pencil, marked `data-edit-pencil`. */
export const EDIT_PENCIL =
  'shrink-0 text-white/0 transition-colors group-hover/edit:text-white/60 group-focus-visible/edit:text-white/60 pointer-coarse:text-white/40';
