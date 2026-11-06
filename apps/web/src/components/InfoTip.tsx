import { type CSSProperties, type ReactNode, useState } from 'react';
import { Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * An info button beside a control's label, saying more about it in a
 * tooltip: on hover or focus, and on a tap, which has neither. Tapping away
 * closes it.
 */
export function InfoTip({
  label,
  children,
}: {
  /** The button's name, as a screen reader gives it. */
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          // Radix closes a tooltip on a click unless this is prevented
          onClick={(e) => {
            e.preventDefault();
            setOpen(true);
          }}
          className="touch-target cursor-pointer rounded-full text-white/50 hover:text-white/80"
        >
          <Info aria-hidden className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="border border-white/20 bg-[oklch(0.2_0.06_230)] text-white"
        style={{ '--tooltip-bg': 'oklch(0.2 0.06 230)' } as CSSProperties}
      >
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
