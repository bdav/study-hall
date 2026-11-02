import type { ReactNode } from 'react';
import { TILE_SHAPE, TILE_SHAPE_WIDE_ON_PHONES } from '@/lib/layout';

/** The face of a tile, shared by deck and course tiles. */
export function Tile({
  children,
  wideOnPhones,
}: {
  children: ReactNode;
  /** Wider still below sm, as a row in a one-column list. */
  wideOnPhones?: boolean;
}) {
  return (
    <div
      className={`relative flex w-full flex-col ${wideOnPhones ? TILE_SHAPE_WIDE_ON_PHONES : TILE_SHAPE} items-center justify-center rounded-xl border border-white/30 bg-white/10 p-4 backdrop-blur-sm`}
    >
      {children}
    </div>
  );
}
