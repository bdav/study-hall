import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Check } from 'lucide-react';
import { chipClassName } from '@/lib/utils';

/**
 * Asks for one of a few answers with a tap: radio buttons shown as chips,
 * none chosen to start. A required choice holds off the form until made.
 */
export function ChoiceChips<Value extends string | number>({
  label,
  options,
  value,
  onChange,
  required,
  lastApart,
  children,
}: {
  label: string;
  options: { value: Value; label: string }[];
  value: Value | null;
  onChange: (value: Value) => void;
  required?: boolean;
  /** The last option goes on a line of its own when the others wrap */
  lastApart?: boolean;
  /** Below the chips, such as a field for an answer of the learner's own */
  children?: ReactNode;
}) {
  const name = useId();

  return (
    <ChipGroup label={label} below={children} lastApart={lastApart}>
      {options.map((option) => (
        <Chip
          key={option.value}
          type="radio"
          name={name}
          label={option.label}
          isChosen={option.value === value}
          required={required}
          onChange={() => onChange(option.value)}
        />
      ))}
    </ChipGroup>
  );
}

/**
 * Asks for any number of a few answers with taps: checkboxes shown as
 * chips, starting at the ones given.
 */
export function CheckChips({
  label,
  options,
  chosen,
  onChange,
  lastApart,
  children,
}: {
  label: string;
  options: string[];
  chosen: string[];
  onChange: (chosen: string[]) => void;
  /** The last option goes on a line of its own when the others wrap */
  lastApart?: boolean;
  /** Below the chips, such as a field for an answer of the learner's own */
  children?: ReactNode;
}) {
  /** Chooses or unchooses an option, keeping the options' order. */
  function toggle(option: string) {
    const next = chosen.includes(option)
      ? chosen.filter((other) => other !== option)
      : [...chosen, option];
    onChange(options.filter((other) => next.includes(other)));
  }

  return (
    <ChipGroup label={label} below={children} lastApart={lastApart}>
      {options.map((option) => (
        <Chip
          key={option}
          type="checkbox"
          label={option}
          isChosen={chosen.includes(option)}
          onChange={() => toggle(option)}
        />
      ))}
    </ChipGroup>
  );
}

function ChipGroup({
  label,
  below,
  lastApart = false,
  children,
}: {
  label: string;
  below?: ReactNode;
  lastApart?: boolean;
  children: ReactNode[];
}) {
  const rest = lastApart ? children.slice(0, -1) : children;
  const last = lastApart ? children.at(-1) : null;
  const restRef = useRef<HTMLDivElement>(null);
  const restWraps = useWraps(restRef, lastApart);

  return (
    <fieldset>
      <legend className="text-sm font-medium text-white/80">{label}</legend>
      <div ref={restRef} className="mt-2 flex flex-wrap gap-2">
        {rest}
        {!restWraps && last}
      </div>
      {restWraps && <div className="mt-2 flex">{last}</div>}
      {below}
    </fieldset>
  );
}

/**
 * Whether the chips in a row, leaving out the last when it's kept apart,
 * run onto more than one line, as the width allows; measured again as the
 * row resizes.
 */
function useWraps(
  ref: React.RefObject<HTMLDivElement | null>,
  lastApart: boolean,
) {
  const [wraps, setWraps] = useState(false);

  useLayoutEffect(() => {
    const row = ref.current;
    if (!row || !lastApart) return;
    const observer = new ResizeObserver(() => {
      const chips = [...row.children] as HTMLElement[];
      // The rest are the chips before the last, wherever it is shown
      const rest = chips.slice(0, wraps ? chips.length : -1);
      setWraps(rest.length > 1 && rest.at(-1)!.offsetTop > rest[0].offsetTop);
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, [ref, lastApart, wraps]);

  return wraps;
}

function Chip({
  type,
  name,
  label,
  isChosen,
  required,
  onChange,
}: {
  type: 'radio' | 'checkbox';
  name?: string;
  label: string;
  isChosen: boolean;
  required?: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`${chipClassName(isChosen)} cursor-pointer has-focus-visible:ring-2 has-focus-visible:ring-white/70`}
    >
      <input
        type={type}
        name={name}
        checked={isChosen}
        required={required}
        onChange={onChange}
        className="sr-only"
      />
      {/* Chosen shows by more than colour */}
      {isChosen && <Check className="size-3.5" aria-hidden />}
      {label}
    </label>
  );
}
