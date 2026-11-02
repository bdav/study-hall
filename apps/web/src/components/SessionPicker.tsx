import { useId } from 'react';
import { STUDY_DIRECTIONS, type StudyDirection } from '@/lib/directions';
import {
  SESSION_TYPES,
  STUDY_MODES,
  type SessionType,
  type StudyMode,
} from '@/lib/sessionChoices';

/** What each Study Direction asks for, below its Direction Label. */
const DIRECTION_DETAILS: Record<StudyDirection, string> = {
  FORWARD: 'Type the answer',
  REVERSE: 'Type the front',
};

/**
 * How to study, before a Study Session starts: its length, Quick, Standard
 * or Deep, and beside it its mode, Study, Drill weakest or Cram (#8, #9),
 * and, on a Reversible Deck, its Study Direction by the deck's Direction
 * Labels (ADR-0011).
 */
export function SessionPicker({
  sessionType,
  onSessionType,
  studyMode,
  onStudyMode,
  direction,
}: {
  sessionType: SessionType;
  onSessionType: (value: SessionType) => void;
  studyMode: StudyMode;
  onStudyMode: (value: StudyMode) => void;
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
        options={STUDY_MODES}
        value={studyMode}
        onChange={onStudyMode}
      />
      {direction && (
        <ChoiceRow
          label="Direction"
          options={STUDY_DIRECTIONS.map((value) => ({
            value,
            label: direction.labels[value],
            detail: DIRECTION_DETAILS[value],
          }))}
          value={direction.value}
          onChange={direction.onChange}
        />
      )}
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
