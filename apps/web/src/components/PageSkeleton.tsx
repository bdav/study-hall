import { Skeleton } from '@/components/ui/skeleton';
import { CenteredPage } from '@/components/CenteredPage';
import { TILE_GRID, TILE_SHAPE_WIDE_ON_PHONES } from '@/lib/layout';

/** A page of tiles, as Flashcards' decks and Courses' courses. */
function TileGridSkeleton() {
  return (
    <CenteredPage>
      <div className="w-full max-w-4xl" role="status" aria-label="Loading">
        <Skeleton className="h-8 w-40" />
        <div className={`mt-6 ${TILE_GRID}`}>
          {[1, 2, 3, 4].map((i) => (
            <Skeleton
              key={i}
              className={`${TILE_SHAPE_WIDE_ON_PHONES} w-full rounded-xl`}
            />
          ))}
        </div>
      </div>
    </CenteredPage>
  );
}

export function DeckListSkeleton() {
  return <TileGridSkeleton />;
}

export function StatsSkeleton() {
  return (
    <CenteredPage>
      <div className="w-full max-w-2xl" role="status" aria-label="Loading">
        <Skeleton className="h-8 w-24" />
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
        <div className="mt-8 space-y-3">
          <Skeleton className="h-6 w-32" />
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </CenteredPage>
  );
}

export function DeckCardsSkeleton() {
  return (
    <CenteredPage>
      <div className="w-full max-w-2xl" role="status" aria-label="Loading">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2 h-10 w-64" />
        <div className="mt-6 space-y-2">
          <Skeleton className="h-6 w-20" />
          <div className="flex gap-2">
            <Skeleton className="h-10 flex-1" />
            <Skeleton className="h-10 flex-1" />
            <Skeleton className="h-10 w-16" />
          </div>
        </div>
        <div className="mt-8 space-y-2">
          <Skeleton className="h-6 w-32" />
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    </CenteredPage>
  );
}

export function StudySkeleton() {
  return (
    <CenteredPage>
      <div className="w-full max-w-2xl" role="status" aria-label="Loading">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2 h-10 w-64" />
      </div>
      {/* Where the study card will sit, at the top of its column (#122) */}
      <div className="mt-6 flex w-full flex-1 flex-col items-center">
        <div className="w-full max-w-md pt-3">
          <Skeleton className="aspect-3/2 w-full rounded-xl" />
        </div>
      </div>
    </CenteredPage>
  );
}

export function CourseListSkeleton() {
  return <TileGridSkeleton />;
}

export function CourseSkeleton() {
  return (
    <CenteredPage>
      <div className="w-full max-w-2xl" role="status" aria-label="Loading">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-2 h-5 w-72" />
        <div className="mt-8 space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </CenteredPage>
  );
}
