import { Loader2 } from 'lucide-react';

/**
 * What shows while the AI writes something the learner waits for, a
 * syllabus or a lesson, in place of everything below the page's header:
 * what's being written, and how long it takes.
 */
export function WritingLoader({
  label,
  title,
  detail,
}: {
  /** The status's accessible name, short. */
  label: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center text-white/80">
      <div
        role="status"
        aria-label={label}
        className="flex items-center gap-2 text-lg"
      >
        <Loader2 className="size-5 animate-spin" aria-hidden />
        {title}
      </div>
      <p className="max-w-md text-sm text-white/60">{detail}</p>
    </div>
  );
}
