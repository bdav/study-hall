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
 * on phones, where the footer's buttons stack and would leave the body a
 * sliver, the whole dialog scrolls instead.
 */
export const tallDialogClassName =
  'flex max-h-[90dvh] flex-col max-sm:overflow-y-auto sm:max-h-[80vh]';

/** The part of a `tallDialogClassName` dialog that scrolls from sm. */
export const tallDialogBodyClassName = 'sm:flex-1 sm:overflow-y-auto';

/** An underlined input on the app's translucent dialogs. */
export const glassInputClassName =
  'rounded-none border-0 border-b-2 border-white/40 bg-transparent text-white shadow-none focus-visible:ring-0 focus-visible:border-white/70 placeholder-white/40';
