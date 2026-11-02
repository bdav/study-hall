import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';

/**
 * A line of text edited in place, as the deck title is: shown with a pencil
 * at rest, or its placeholder when empty; choosing it turns it into a box,
 * saved as you type, a moment after you stop (`onSave`, trimmed, only when
 * changed). Enter, Escape or leaving the box ends editing.
 */
export function InPlaceField({
  label,
  editLabel,
  value,
  placeholder,
  maxLength,
  onSave,
  className = '',
}: {
  /** Names the box while editing. */
  label: string;
  /** Names the text at rest, which is a button that starts editing. */
  editLabel: string;
  value: string;
  placeholder: string;
  maxLength?: number;
  onSave: (value: string) => void;
  className?: string;
}) {
  const [localValue, setLocalValue] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  const [isEditing, setIsEditing] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  // Follows the server's value while not being edited
  if (value !== prevValue) {
    setPrevValue(value);
    if (!isEditing) setLocalValue(value);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function debouncedSave(next: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const trimmed = next.trim();
      if (trimmed !== value) onSaveRef.current(trimmed);
    }, 800);
  }

  if (!isEditing) {
    return (
      <button
        type="button"
        aria-label={editLabel}
        title={editLabel}
        onClick={() => setIsEditing(true)}
        className={`group inline-flex max-w-full cursor-text items-center gap-1.5 text-left ${className}`}
      >
        <span
          className={`break-words ${localValue ? '' : 'text-white/40 italic'}`}
        >
          {localValue || placeholder}
        </span>
        <Pencil className="h-3.5 w-3.5 shrink-0 text-white/40 group-hover:text-white/60" />
      </button>
    );
  }

  return (
    <input
      type="text"
      aria-label={label}
      value={localValue}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => {
        setLocalValue(e.target.value);
        debouncedSave(e.target.value);
      }}
      onBlur={() => setIsEditing(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') setIsEditing(false);
      }}
      autoFocus
      className={`min-w-0 border-b-2 border-white/30 bg-transparent text-white outline-none transition-colors placeholder:text-white/30 focus:border-white/60 ${className}`}
    />
  );
}
