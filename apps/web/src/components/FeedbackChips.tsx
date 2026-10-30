import { useId } from 'react';
import { Check } from 'lucide-react';
import type { ChipGroups } from '@/lib/feedback';
import { chipClassName } from '@/lib/utils';

/**
 * Asks what should change with a tap, for regenerating something the
 * learner has read: several chips at once, kept in the order shown.
 */
export function FeedbackChips<Chip extends string>({
  groups,
  chosen,
  onChange,
  disabled,
}: {
  groups: ChipGroups<Chip>;
  chosen: Chip[];
  onChange: (chosen: Chip[]) => void;
  disabled?: boolean;
}) {
  const labelId = useId();

  /** Chooses or unchooses a chip, its opposite giving way; in display order. */
  function toggle(chip: Chip, group: { chip: Chip }[]) {
    const next = chosen.includes(chip)
      ? chosen.filter((other) => other !== chip)
      : [
          ...chosen.filter((other) => !group.some((g) => g.chip === other)),
          chip,
        ];
    onChange(
      groups
        .flat()
        .map(({ chip }) => chip)
        .filter((other) => next.includes(other)),
    );
  }

  return (
    <div role="group" aria-labelledby={labelId}>
      <p id={labelId} className="text-sm font-medium text-white/80">
        What should change?
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {groups.flatMap((group) =>
          group.map(({ chip, label }) => {
            const isChosen = chosen.includes(chip);
            return (
              <button
                key={chip}
                type="button"
                aria-pressed={isChosen}
                disabled={disabled}
                onClick={() => toggle(chip, group)}
                className={`${chipClassName(isChosen)} outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50`}
              >
                {/* Chosen shows by more than colour */}
                {isChosen && <Check className="size-3.5" aria-hidden />}
                {label}
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}
