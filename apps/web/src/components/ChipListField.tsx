import { useId } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { withTyped } from '@/lib/lists';

/**
 * A list the learner builds item by item inside a larger form: each item a
 * chip they can remove, with a field to add one. Enter in the field adds
 * the item rather than submitting the form. The text being typed is the
 * caller's, so the form can add it should the learner submit without
 * adding it (`withTyped`). `inputClassName` styles the field like the
 * form's others.
 */
export function ChipListField({
  label,
  inputLabel,
  placeholder,
  items,
  onChange,
  text,
  onTextChange,
  maxLength,
  inputClassName,
}: {
  label: string;
  inputLabel: string;
  placeholder: string;
  items: string[];
  onChange: (items: string[]) => void;
  text: string;
  onTextChange: (text: string) => void;
  maxLength?: number;
  inputClassName?: string;
}) {
  const labelId = useId();
  const inputId = useId();
  const canAdd = text.trim() !== '';

  function add() {
    if (!canAdd) return;
    onChange(withTyped(items, text));
    onTextChange('');
  }

  return (
    <div>
      <p id={labelId} className="text-sm font-medium text-white/80">
        {label}
      </p>
      {items.length > 0 && (
        <ul aria-labelledby={labelId} className="mt-2 flex flex-wrap gap-2">
          {items.map((item) => (
            <li
              key={item}
              className="flex items-center gap-1 rounded-full bg-white/10 py-0.5 pr-1 pl-3 text-sm"
            >
              {item}
              <button
                type="button"
                aria-label={`Remove ${item}`}
                onClick={() =>
                  onChange(items.filter((other) => other !== item))
                }
                className="touch-target rounded-full p-0.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-center gap-2">
        <label htmlFor={inputId} className="sr-only">
          {inputLabel}
        </label>
        <Input
          id={inputId}
          value={text}
          placeholder={placeholder}
          maxLength={maxLength}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          className={inputClassName}
        />
        <button
          type="button"
          disabled={!canAdd}
          onClick={add}
          className="shrink-0 rounded-lg bg-white/20 px-3 py-1.5 text-sm text-white hover:bg-white/30 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}
