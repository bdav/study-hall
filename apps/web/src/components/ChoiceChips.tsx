import { useId } from 'react';
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
}: {
  label: string;
  options: { value: Value; label: string }[];
  value: Value | null;
  onChange: (value: Value) => void;
  required?: boolean;
}) {
  const name = useId();

  return (
    <fieldset>
      <legend className="text-sm font-medium text-white/80">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => {
          const isChosen = option.value === value;
          return (
            <label
              key={option.value}
              className={`${chipClassName(isChosen)} cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-white/70`}
            >
              <input
                type="radio"
                name={name}
                checked={isChosen}
                required={required}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {/* Chosen shows by more than colour */}
              {isChosen && <Check className="size-3.5" aria-hidden />}
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
