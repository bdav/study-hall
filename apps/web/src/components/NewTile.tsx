import { Plus } from 'lucide-react';

/** What a New tile shows, first in its area's tiles. */
export function NewTileFace({ label }: { label: string }) {
  return (
    <>
      <Plus className="h-10 w-10 text-white/60" aria-hidden />
      <p className="mt-2 text-sm font-medium text-white/60">{label}</p>
    </>
  );
}
