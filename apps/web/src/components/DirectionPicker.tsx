import { useId } from 'react';
import { STUDY_DIRECTIONS, type StudyDirection } from '@/lib/directions';

/**
 * A Reversible Deck's two Study Directions as buttons by their Direction
 * Labels, the chosen one pressed (ADR-0011), under a label saying what the
 * choice is for.
 */
export function DirectionPicker({
  label = 'Direction',
  labels,
  value,
  onChange,
  className = '',
}: {
  label?: string;
  labels: Record<StudyDirection, string>;
  value: StudyDirection;
  onChange: (value: StudyDirection) => void;
  className?: string;
}) {
  const labelId = useId();
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className={`flex flex-wrap items-center gap-2 text-xs ${className}`}
    >
      <span id={labelId} className="uppercase tracking-wide text-white/50">
        {label}
      </span>
      {STUDY_DIRECTIONS.map((direction) => (
        <button
          key={direction}
          type="button"
          aria-pressed={direction === value}
          onClick={() => onChange(direction)}
          className={`cursor-pointer rounded-md border px-2 py-1 transition-colors ${
            direction === value
              ? 'border-white/60 bg-white/20 text-white'
              : 'border-white/20 text-white/60 hover:bg-white/10 hover:text-white/80'
          }`}
        >
          {labels[direction]}
        </button>
      ))}
    </div>
  );
}
