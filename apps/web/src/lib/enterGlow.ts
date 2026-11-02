/*
 * The glow on a control says pressing Enter now would press it (#94): it
 * shows on the control that has focus, or, where a page's Enter shortcut
 * presses one when nothing has focus, on that one, and never on two at once.
 */

/**
 * The glow on a box's submit arrow while the box has focus: Enter there
 * submits it, from a keyboard or a phone's own return key.
 */
export const ENTER_GLOW = 'animate-pulse-halo';

/**
 * The glow on a button Enter would press: none on touch screens, which
 * have no keyboard to press Enter from.
 */
export const KEYBOARD_ENTER_GLOW =
  'animate-pulse-halo pointer-coarse:animate-none';

/**
 * The glow on a create tile's contents while the tile, marked `group/new`,
 * has focus: Enter opens its form. None on touch screens.
 */
export const TILE_ENTER_GLOW =
  'pointer-fine:group-focus/new:animate-pulse-halo';

/** The glow on a card's border, as a button's: none on touch screens. */
export const KEYBOARD_ENTER_GLOW_BORDER =
  'animate-pulse-halo-border pointer-coarse:animate-none';
