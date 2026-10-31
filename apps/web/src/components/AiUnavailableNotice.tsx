import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Shown in place of a course's creation when AI can't be used: why, and
 * that flashcards are still there.
 */
export function AiUnavailableNotice({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="max-w-md text-center text-white">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-white/70">{children}</p>
      <p className="mt-4 text-white/70">
        Standalone{' '}
        <Link to="/flashcards" className="underline hover:text-white">
          flashcards
        </Link>{' '}
        are fully available.
      </p>
    </div>
  );
}
