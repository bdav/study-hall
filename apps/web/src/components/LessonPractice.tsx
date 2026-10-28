import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import type { PracticeView } from '@/lib/lessonSteps';
import { LessonExercise } from '@/components/LessonExercise';

type Lesson = inferRouterOutputs<AppRouter>['lesson']['getById'];
type LessonVersion = NonNullable<Lesson['version']>;

/** How the learner has Practice set up, and the exercise on screen. */
export interface PracticeSettings {
  view: PracticeView;
  showMyAnswers: boolean;
  showAnswerKey: boolean;
  /** The exercise shown one at a time; the lesson's steps move between them. */
  exerciseIndex: number;
}

/**
 * The Practice step: the lesson's exercises one at a time or all on one
 * page, with the learner's answers and the answer key shown or not.
 */
export function LessonPractice({
  lesson,
  version,
  settings,
}: {
  lesson: Lesson;
  version: LessonVersion;
  settings: PracticeSettings;
}) {
  const { exercises } = version;
  const exerciseItem = (index: number) => {
    const exercise = exercises[index];
    return (
      <LessonExercise
        // Starting over or hiding answers gives every exercise a fresh start
        key={`${exercise.id}:${lesson.resetAt ?? ''}:${settings.showMyAnswers}`}
        exercise={exercise}
        index={index}
        lessonId={lesson.id}
        showMyAnswer={settings.showMyAnswers}
        showAnswerKey={settings.showAnswerKey}
      />
    );
  };

  return (
    <section>
      <h2 className="text-xl font-semibold">Practice</h2>
      <div className="mt-4">
        {settings.view === 'one' && exercises.length > 0 ? (
          <>
            <p className="mb-3 text-sm text-white/60">
              Exercise {settings.exerciseIndex + 1} of {exercises.length}
            </p>
            <ol aria-label="Exercises">
              {exerciseItem(settings.exerciseIndex)}
            </ol>
          </>
        ) : (
          <ol aria-label="Exercises" className="space-y-3">
            {exercises.map((_, index) => exerciseItem(index))}
          </ol>
        )}
      </div>
      {/* Open Exercises can need AI to check, so the API hides them from
          learners without AI access (ADR-0005) */}
      {version.hiddenExerciseCount > 0 && (
        <p className="mt-3 text-sm text-white/50">
          {version.hiddenExerciseCount === 1
            ? '1 more exercise needs'
            : `${version.hiddenExerciseCount} more exercises need`}{' '}
          AI to check your answers, and your account doesn&apos;t have access to
          AI features.
        </p>
      )}
    </section>
  );
}
