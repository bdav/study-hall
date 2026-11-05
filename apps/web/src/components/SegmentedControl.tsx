/**
 * A choice between a few options as a segmented control, one pressed
 * button per option, such as a lesson step's view or a Reversible Deck's
 * Study Direction. Named by `label`, or by the element `labelledBy` names
 * when the label is shown beside it. Its display is the caller's, in
 * `className`, so it can be hidden where there's no room.
 */
export function SegmentedControl<T extends string>({
  label,
  labelledBy,
  options,
  value,
  onChange,
  className = '',
}: {
  label?: string;
  labelledBy?: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      aria-labelledby={labelledBy}
      className={`shrink-0 rounded-lg border border-white/20 bg-white/5 p-0.5 text-sm ${className}`}
    >
      {options.map((option) => {
        const pressed = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(option.value)}
            className={`flex-1 cursor-pointer rounded-md px-3 py-1 pointer-coarse:min-h-touch ${
              pressed
                ? 'bg-white/20 text-white'
                : 'text-white/70 hover:text-white'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
