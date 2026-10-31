import { type ReactNode } from 'react';
/** What's wrong with a field's answer, beside it. */
export function FieldError({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  return (
    <p id={id} className="mt-1 text-sm text-red-300">
      {children}
    </p>
  );
}
