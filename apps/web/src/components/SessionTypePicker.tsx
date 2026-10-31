import { SESSION_TYPES, type SessionType } from '@/lib/sessionTypes';

/**
 * Quick, Standard or Deep, before a Study Session starts: a row of buttons,
 * the chosen one pressed, each saying how many cards it holds. Buttons
 * rather than radios, whose arrow keys would take the page's ← and →.
 */
export function SessionTypePicker({
  value,
  onChange,
}: {
  value: SessionType;
  onChange: (value: SessionType) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Session length"
      className="mb-4 flex w-full max-w-md gap-2"
    >
      {SESSION_TYPES.map((type) => {
        const isChosen = type.value === value;
        return (
          <button
            key={type.value}
            type="button"
            aria-pressed={isChosen}
            onClick={() => onChange(type.value)}
            className={`flex flex-1 cursor-pointer flex-col items-center rounded-lg border px-2 py-1.5 transition-colors ${
              isChosen
                ? 'border-white/60 bg-white/20 text-white'
                : 'border-white/20 text-white/60 hover:bg-white/10 hover:text-white/80'
            }`}
          >
            <span className="text-sm font-semibold">{type.label}</span>
            <span className="text-xs opacity-80">{type.cards}</span>
          </button>
        );
      })}
    </div>
  );
}
