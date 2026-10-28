/**
 * Where an item shown one at a time sits among its step's items: numbers
 * only ("2 / 8"), since the step's heading names them, and in full for
 * screen readers.
 */
export function ItemCount({
  noun,
  index,
  count,
}: {
  noun: 'Example' | 'Exercise';
  index: number;
  count: number;
}) {
  return (
    <p className="shrink-0 text-xs text-white/50 tabular-nums">
      <span aria-hidden="true">
        {index + 1} / {count}
      </span>
      <span className="sr-only">
        {noun} {index + 1} of {count}
      </span>
    </p>
  );
}
