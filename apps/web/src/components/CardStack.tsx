import { type ReactNode } from 'react';

interface CardStackProps {
  queueLength: number;
  children: ReactNode;
  backChildren?: ReactNode;
  isFlipped?: boolean;
  progress?: string;
  className?: string;
  onClick?: () => void;
}

export function CardStack({
  queueLength,
  children,
  backChildren,
  isFlipped,
  progress,
  className,
  onClick,
}: CardStackProps) {
  const hasFlip = backChildren !== undefined;

  return (
    <div
      className="relative w-full max-w-md pt-3"
      style={hasFlip ? { perspective: '600px' } : undefined}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {queueLength > 2 && (
        <div className="absolute inset-x-2 top-0 aspect-3/2 rounded-xl border border-white/30" />
      )}
      {queueLength > 1 && (
        <div className="absolute inset-x-1 top-1.5 aspect-3/2 rounded-xl border border-white/30" />
      )}
      {hasFlip ? (
        // The faces share one grid cell, so the card grows to fit the taller
        // face; one column as wide as the card, so long text wraps
        <div
          className="relative grid w-full grid-cols-1 transition-transform duration-500"
          style={{
            transformStyle: 'preserve-3d',
            transform: isFlipped ? 'rotateY(-180deg)' : 'rotateY(0deg)',
          }}
        >
          {/* Front face */}
          <div
            className={`relative col-start-1 row-start-1 flex aspect-3/2 w-full flex-col items-center justify-center self-stretch rounded-xl border border-white/30 bg-white/10 p-8 backdrop-blur-sm ${className ?? ''}`}
            style={{ backfaceVisibility: 'hidden' }}
            inert={isFlipped}
          >
            {children}
            {progress && (
              <span className="absolute bottom-3 right-4 text-xs text-white/50">
                {progress}
              </span>
            )}
          </div>
          {/* Back face */}
          <div
            className={`relative col-start-1 row-start-1 flex aspect-3/2 w-full flex-col items-center justify-center self-stretch rounded-xl border border-white/30 bg-white/15 p-8 backdrop-blur-sm ${className ?? ''}`}
            style={{
              backfaceVisibility: 'hidden',
              transform: 'rotateY(-180deg)',
            }}
            inert={!isFlipped}
          >
            {backChildren}
            {progress && (
              <span className="absolute bottom-3 right-4 text-xs text-white/50">
                {progress}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div
          className={`relative flex aspect-3/2 w-full flex-col items-center justify-center rounded-xl border border-white/30 bg-white/10 p-8 backdrop-blur-sm ${className ?? ''}`}
        >
          {children}
          {progress && (
            <span className="absolute bottom-3 right-4 text-xs text-white/50">
              {progress}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
