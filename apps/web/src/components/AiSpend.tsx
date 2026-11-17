import {
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router-dom';
import { CircleDollarSign } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { formatUsd } from '@/lib/format';

/** How long the panel waits, once the pointer or focus leaves, to close. */
const CLOSE_DELAY_MS = 150;

const isMouse = (e: PointerEvent) => e.pointerType === 'mouse';

/**
 * The learner's own AI spend this month against their cap (#119, #130), as
 * an icon in the site navigation for learners who can use AI, marked while
 * AI is paused for them. Hovering or focusing it shows the spend, whether
 * AI is paused, and a link to AI usage; on a touch screen, which has no
 * hover, tapping it does. The panel sits right after the icon, so Tab goes
 * from the icon to its link and on through the bar, and it closes once the
 * pointer and focus have both left, on Escape, or on a tap elsewhere.
 */
export function AiSpend({
  canUseAI,
  className,
}: {
  canUseAI: boolean;
  className: string;
}) {
  const summary = trpc.aiUsage.summary.useQuery(undefined, {
    enabled: canUseAI,
  });
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  // Set while Escape gives focus back to the icon, which mustn't reopen it
  const focusReturning = useRef(false);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  // A tap or click anywhere else closes it
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: globalThis.PointerEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  if (!canUseAI || !summary.data) return null;
  const { spentUsd, capUsd, paused } = summary.data;

  const hasFocus = () =>
    wrapperRef.current?.contains(document.activeElement) ?? false;
  function openNow() {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  }
  function closeSoon() {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(
      () => setOpen(false),
      CLOSE_DELAY_MS,
    );
  }

  return (
    <div
      ref={wrapperRef}
      className="relative"
      onPointerEnter={(e) => isMouse(e) && openNow()}
      // Focus on the icon or in the panel keeps it open
      onPointerLeave={(e) => isMouse(e) && !hasFocus() && closeSoon()}
      onFocus={() => !focusReturning.current && openNow()}
      onBlur={(e: FocusEvent) => {
        if (!wrapperRef.current?.contains(e.relatedTarget)) closeSoon();
      }}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key !== 'Escape' || !open) return;
        setOpen(false);
        if (document.activeElement !== triggerRef.current) {
          focusReturning.current = true;
          triggerRef.current?.focus();
          focusReturning.current = false;
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={
          paused ? 'AI spend this month, AI paused' : 'AI spend this month'
        }
        aria-expanded={open}
        aria-controls={panelId}
        onClick={openNow}
        className={`relative cursor-pointer ${className}`}
      >
        <CircleDollarSign className="h-4 w-4" aria-hidden />
        {paused && (
          <span
            data-paused-mark
            aria-hidden
            className="absolute top-1 right-1 size-2 rounded-full bg-amber-300 sm:-top-0.5 sm:-right-0.5"
          />
        )}
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="AI spend this month"
          className="absolute top-full right-0 z-50 mt-2 flex w-64 flex-col gap-2.5 rounded-lg border border-white/20 bg-[oklch(0.2_0.06_230)] p-2.5 text-sm text-white shadow-md"
        >
          <p>
            Your AI this month: {formatUsd(spentUsd)} of {formatUsd(capUsd)}
          </p>
          {paused && (
            <p className="text-amber-200">
              AI features are paused until next month because you've reached
              this month's AI spending cap. Your existing courses still work.
            </p>
          )}
          <Link
            to="/ai-usage"
            onClick={() => setOpen(false)}
            className="touch-target self-start text-white/80 underline underline-offset-2 hover:text-white"
          >
            See AI usage
          </Link>
        </div>
      )}
    </div>
  );
}
