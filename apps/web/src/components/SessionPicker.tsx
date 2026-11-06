import { useId, useState } from 'react';
import { STUDY_DIRECTIONS, type StudyDirection } from '@/lib/directions';
import { countOf } from '@/lib/format';
import { glassInputClassName } from '@/lib/utils';
import { InfoTip } from '@/components/InfoTip';
import { Input } from '@/components/ui/input';
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

// A date in the UTC day it's stored for, as the API reads it
const cramDateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** The Cram Date, its pace for NEW cards and how to change it (#87). */
type CramDateField = {
  /** The deck's date, "2027-06-01", if it has one. */
  value: string | null;
  /** How many NEW cards a day reach it, and how many a session takes. */
  pace: { newPerDay: number; inSession: number } | null;
  hasFailed: boolean;
  onChange: (value: string | null) => void;
};

/**
 * How to study, before a Study Session starts: its length, Quick, Standard
 * or Deep, and beside it its mode, Study, Drill weakest or Cram (#8, #9),
 * with Cram's date (#87), and, on a Reversible Deck, its Study Direction by
 * the deck's Direction Labels (ADR-0011), as a segmented control: a way
 * round, not a mix or a size like the others.
 */
export function SessionPicker({
  sessionType,
  onSessionType,
  studyMode,
  onStudyMode,
  offersReviewRetired = false,
  cramDate,
  direction,
}: {
  sessionType: SessionType;
  onSessionType: (value: SessionType) => void;
  studyMode: StudyMode;
  onStudyMode: (value: StudyMode) => void;
  /** Review retired, offered only on a deck with retired cards (#86). */
  offersReviewRetired?: boolean;
  cramDate: CramDateField;
  /** On a Reversible Deck, the direction chosen and the deck's labels. */
  direction?: {
    value: StudyDirection;
    labels: Record<StudyDirection, string>;
    onChange: (value: StudyDirection) => void;
  };
}) {
  return (
    <div className="mx-auto mt-6 flex w-full max-w-md flex-col gap-5">
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
      {studyMode === 'CRAM' && <CramDateRow {...cramDate} />}
      {direction && <DirectionRow {...direction} />}
    </div>
  );
}

/** What a Cram Date does: what it would do, or what it's doing. */
function cramDateDetail(value: string | null) {
  if (!value) {
    return 'Optional: the day you need to know this deck by. Cram paces reviews and new cards toward it.';
  }
  const date = cramDateFormat.format(new Date(value));
  return `Reviews come back sooner as ${date} nears, and new cards are paced to reach it. Only Cram uses this date.`;
}

/** What the Cram Date asks of NEW cards; none with none left to see. */
function paceMessage(
  value: string,
  { newPerDay, inSession }: NonNullable<CramDateField['pace']>,
) {
  if (newPerDay === 0) return null;
  const date = cramDateFormat.format(new Date(value));
  const pace = `${countOf(newPerDay, 'new card')} a day to see them all by ${date}`;
  return inSession < newPerDay
    ? `${pace}; this session takes ${inSession}`
    : pace;
}

/**
 * The Cram Date, saved as soon as it's a whole date from today on: a date
 * field gives a part-typed year, or nothing, along the way, which stays in
 * the field until it's left.
 */
function CramDateRow({ value, pace, hasFailed, onChange }: CramDateField) {
  const id = useId();
  const [typed, setTyped] = useState<string | null>(null);
  // Today in UTC, when the API takes a date to have passed
  const today = new Date().toISOString().slice(0, 10);
  const message = value && pace && paceMessage(value, pace);
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <label
          htmlFor={id}
          className="text-xs uppercase tracking-wide text-white/50"
        >
          Cram until
        </label>
        <InfoTip label="About Cram until">{cramDateDetail(value)}</InfoTip>
      </div>
      <div className="flex items-center gap-3">
        <Input
          id={id}
          type="date"
          min={today}
          value={typed ?? value ?? ''}
          onChange={(e) => {
            setTyped(e.target.value);
            if (e.target.value >= today) onChange(e.target.value);
          }}
          onBlur={() => setTyped(null)}
          className={`max-w-48 [color-scheme:dark] ${glassInputClassName}`}
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              setTyped(null);
              onChange(null);
            }}
            className="touch-target cursor-pointer text-sm text-white/50 underline hover:text-white/80"
          >
            Clear date
          </button>
        )}
      </div>
      {hasFailed ? (
        <p role="alert" className="mt-1 text-xs text-white/70">
          Couldn't save the date. Please try again.
        </p>
      ) : (
        message && <p className="mt-1 text-xs text-white/50">{message}</p>
      )}
    </div>
  );
}

/**
 * The Study Direction under its label, as a segmented control the width of
 * the rows above, with a line saying what the one chosen asks for, in
 * view as it changes with the choice.
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
