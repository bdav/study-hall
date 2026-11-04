import { useId } from 'react';
import { STUDY_DIRECTIONS, type StudyDirection } from '@/lib/directions';
import { SegmentedControl } from '@/components/SegmentedControl';
import {
  SESSION_TYPES,
  STUDY_MODES,
  type SessionType,
  type StudyMode,
} from '@/lib/sessionChoices';

/** What the Study Direction chosen asks for, below the choice. */
const DIRECTION_DETAILS: Record<StudyDirection, string> = {
  FORWARD: 'Each card shows its front; type the answer',
  REVERSE: 'Each card shows its answer; type the front',
};

/**
 * How to study, before a Study Session starts: its length, Quick, Standard
 * or Deep, and beside it its mode, Study, Drill weakest or Cram (#8, #9),
 * and, on a Reversible Deck, its Study Direction by the deck's Direction
 * Labels (ADR-0011), as a segmented control: a way round, not a mix or a
 * size like the others.
 */
export function SessionPicker({
  sessionType,
  onSessionType,
  studyMode,
  onStudyMode,
  offersReviewRetired = false,
  direction,
}: {
  sessionType: SessionType;
  onSessionType: (value: SessionType) => void;
  studyMode: StudyMode;
  onStudyMode: (value: StudyMode) => void;
  /** Review retired, offered only on a deck with retired cards (#86). */
  offersReviewRetired?: boolean;
  /** On a Reversible Deck, the direction chosen and the deck's labels. */
  direction?: {
    value: StudyDirection;
    labels: Record<StudyDirection, string>;
    onChange: (value: StudyDirection) => void;
  };
}) {
  return (
    <div className="mx-auto mt-6 flex w-full max-w-md flex-col gap-3">
      <ChoiceRow
        label="Session length"
        options={SESSION_TYPES}
        value={sessionType}
        onChange={onSessionType}
      />
      <ChoiceRow
        label="Study mode"
        options={STUDY_MODES.filter(
          (mode) => offersReviewRetired || mode.value !== 'REVIEW_RETIRED',
        )}
        value={studyMode}
        onChange={onStudyMode}
      />
      {direction && <DirectionRow {...direction} />}
    </div>
  );
}

/**
 * The Study Direction under its label, as a segmented control the width of
 * the rows above, with a line saying what the one chosen asks for.
 */
function DirectionRow({
  value,
  labels,
  onChange,
}: {
  value: StudyDirection;
  labels: Record<StudyDirection, string>;
  onChange: (value: StudyDirection) => void;
}) {
  const labelId = useId();
  return (
    <div>
      <p
        id={labelId}
        className="mb-1 text-xs uppercase tracking-wide text-white/50"
      >
        Direction
      </p>
      <SegmentedControl
        labelledBy={labelId}
        options={STUDY_DIRECTIONS.map((direction) => ({
          value: direction,
          label: labels[direction],
        }))}
        value={value}
        onChange={onChange}
        className="flex w-full"
      />
      <p className="mt-1 text-xs text-white/50">{DIRECTION_DETAILS[value]}</p>
    </div>
  );
}

/**
 * A row of buttons under a label saying what it chooses, the chosen one
 * pressed, each with a line saying what it gives. Buttons rather than
 * radios, whose arrow keys would take the page's ← and →.
 */
function ChoiceRow<Value extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: Value; label: string; detail: string }[];
  value: Value;
  onChange: (value: Value) => void;
}) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId}>
      <p
        id={labelId}
        className="mb-1 text-xs uppercase tracking-wide text-white/50"
      >
        {label}
      </p>
      <div className="flex gap-2">
        {options.map((option) => {
          const isChosen = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isChosen}
              onClick={() => onChange(option.value)}
              className={`flex flex-1 cursor-pointer flex-col items-center rounded-lg border px-2 py-1.5 text-center transition-colors ${
                isChosen
                  ? 'border-white/60 bg-white/20 text-white'
                  : 'border-white/20 text-white/60 hover:bg-white/10 hover:text-white/80'
              }`}
            >
              <span className="text-sm font-semibold">{option.label}</span>
              <span className="text-xs opacity-80">{option.detail}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
