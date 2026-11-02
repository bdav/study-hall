import { type ReactNode } from 'react';

/**
 * An on-or-off setting as a switch, for settings that don't depend on each
 * other, unlike the options of a view (`SegmentedControl`).
 */
export function Switch({
  checked,
  onChange,
  children,
  className = '',
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm text-white/80 hover:text-white ${className}`}
    >
      <span
        aria-hidden
        className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-white/80' : 'bg-white/20'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-3 rounded-full transition-transform ${
            checked ? 'translate-x-3 bg-[oklch(0.3_0.1_228)]' : 'bg-white/80'
          }`}
        />
      </span>
      {children}
    </button>
  );
}
