import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** An underlined input on the app's translucent dialogs. */
export const glassInputClassName =
  'rounded-none border-0 border-b-2 border-white/40 bg-transparent text-white shadow-none focus-visible:ring-0 focus-visible:border-white/70 placeholder-white/40';
