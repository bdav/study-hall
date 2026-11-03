import { useId } from 'react';
import { STUDY_DIRECTIONS, type StudyDirection } from '@/lib/directions';
import { SegmentedControl } from '@/components/SegmentedControl';

/**
 * A Reversible Deck's two Study Directions as a segmented control by their
 * Direction Labels (ADR-0011), below a label saying what the choice is
 * for.
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
    <div className={`flex flex-col items-start gap-1.5 ${className}`}>
      <span
        id={labelId}
        className="text-xs uppercase tracking-wide text-white/50"
      >
        {label}
      </span>
      <SegmentedControl
        labelledBy={labelId}
        options={STUDY_DIRECTIONS.map((direction) => ({
          value: direction,
          label: labels[direction],
        }))}
        value={value}
        onChange={onChange}
        className="inline-flex"
      />
    </div>
  );
}
