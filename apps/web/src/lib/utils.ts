import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** The app's translucent dialogs. */
export const glassDialogClassName =
  'border border-white/20 bg-[oklch(0.25_0.08_230)] text-white backdrop-blur-md';

/**
 * A dialog that can be taller than the screen: from sm, its body
 * (`tallDialogBodyClassName`) scrolls between a fixed header and footer;
 * on phones, where a fixed body would be left a sliver, the whole dialog
 * scrolls instead, its footer pinned to the bottom
 * (`tallDialogFooterClassName`).
 */
export const tallDialogClassName =
  'flex max-h-[90dvh] flex-col max-sm:overflow-y-auto sm:max-h-[80vh]';

/** The part of a `tallDialogClassName` dialog that scrolls from sm. */
export const tallDialogBodyClassName = 'sm:flex-1 sm:overflow-y-auto';

/**
 * A `tallDialogClassName` dialog's footer. On phones, where the whole
 * dialog scrolls, it stays pinned to the dialog's bottom, so its actions
 * are in reach however long the list above, its buttons in a row (wrapping
 * if need be) rather than stacked, leaving the body room.
 */
export const tallDialogFooterClassName =
  'max-sm:sticky max-sm:bottom-0 max-sm:flex-row max-sm:flex-wrap max-sm:justify-end max-sm:bg-[oklch(0.25_0.08_230)]';

/** An underlined input on the app's translucent dialogs. */
/** A boxed field on the glass background, as the course form's are. */
export const glassFieldClassName =
  'border-white/20 bg-white/10 text-white placeholder-white/40 focus-visible:border-white/40 focus-visible:ring-white/20';

export const glassInputClassName =
  'rounded-none border-0 border-b-2 border-white/40 bg-transparent text-white shadow-none focus-visible:ring-0 focus-visible:border-white/70 placeholder-white/40';

/** A chip the learner taps to choose an answer, chosen or not. */
export function chipClassName(isChosen: boolean) {
  return `inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors ${
    isChosen
      ? 'border-white/80 bg-white/25 text-white'
      : 'border-white/25 text-white/75 hover:bg-white/10 hover:text-white'
  }`;
}
