import { keepPreviousData } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

/**
 * Options for a query whose input changes while its page stays, as with a
 * picker, filter or tab on the page: what's shown stays until the new data
 * loads, as a page's loading skeleton is for its first load only (#113).
 */
export const STEADY_QUERY = { placeholderData: keepPreviousData };

/**
 * Props for what such a query shows: dimmed and marked busy while it's the
 * data kept from before, its `isPlaceholderData`.
 */
export function steadyContent(isKept: boolean, className?: string) {
  return {
    'aria-busy': isKept,
    className: cn(className, isKept && 'opacity-60 transition-opacity'),
  };
}
