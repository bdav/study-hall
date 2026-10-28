import { Link } from 'react-router-dom';
import { stepSearch, type LessonStep } from '@/lib/lessonSteps';

/**
 * The lesson's steps as a list of links, the current one marked, with how
 * many exercises have been answered beside Practice.
 */
export function LessonOutline({
  steps,
  currentId,
  answeredCount,
  exerciseCount,
  onNavigate,
}: {
  steps: LessonStep[];
  currentId: string;
  answeredCount: number;
  exerciseCount: number;
  /** Called when a step is chosen, such as to close the drawer. */
  onNavigate?: (step: LessonStep) => void;
}) {
  return (
    <nav aria-label="Lesson outline">
      <ol className="space-y-0.5">
        {steps.map((step) => {
          const isCurrent = step.id === currentId;
          return (
            <li key={step.id}>
              <Link
                to={stepSearch(step)}
                onClick={() => onNavigate?.(step)}
                aria-current={isCurrent ? 'step' : undefined}
                className={`block rounded-lg border-l-2 px-3 py-1.5 text-sm ${
                  isCurrent
                    ? 'border-white bg-white/15 font-medium text-white'
                    : 'border-transparent text-white/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                {step.title}
                {step.kind === 'practice' && exerciseCount > 0 && (
                  <span className="block text-xs font-normal text-white/60">
                    {answeredCount} of {exerciseCount} answered
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
