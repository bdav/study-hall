import { describe, it, expect } from 'vitest';
import {
  buildEvaluationPrompt,
  exerciseEvaluationSchema,
} from './exerciseEvaluation.js';

const validOutput = {
  evaluation: 'CORRECT',
  feedback: 'Right: "Come va?" is a natural way to ask how someone is.',
};

describe('exerciseEvaluationSchema', () => {
  it.each(['CORRECT', 'INCORRECT'])(
    'accepts a %s evaluation with feedback',
    (evaluation) => {
      const output = { ...validOutput, evaluation };

      expect(exerciseEvaluationSchema.parse(output)).toEqual(output);
    },
  );

  it.each([
    ['an unknown evaluation', { ...validOutput, evaluation: 'PARTIAL' }],
    ['a missing evaluation', { feedback: validOutput.feedback }],
    ['blank feedback', { ...validOutput, feedback: '  ' }],
    ['missing feedback', { evaluation: 'CORRECT' }],
  ])('rejects %s', (_, output) => {
    expect(exerciseEvaluationSchema.safeParse(output).success).toBe(false);
  });

  it('trims the feedback', () => {
    expect(
      exerciseEvaluationSchema.parse({ ...validOutput, feedback: ' Right. ' })
        .feedback,
    ).toBe('Right.');
  });
});

describe('buildEvaluationPrompt', () => {
  it('sends a short answer with its expected answers and the learner answer', () => {
    const prompt = buildEvaluationPrompt(
      {
        type: 'SHORT_ANSWER',
        prompt: 'Translate: How are you?',
        expectedAnswers: ['Come stai?', 'Come sta?'],
        expectedPoints: [],
      },
      'Come va?',
    );

    expect(prompt).toContain('Translate: How are you?');
    expect(prompt).toContain('- Come stai?\n- Come sta?');
    expect(prompt).toContain('Come va?');
    expect(prompt).not.toMatch(/points/i);
  });

  it('sends a free-form explanation with its expected points', () => {
    const prompt = buildEvaluationPrompt(
      {
        type: 'FREE_FORM_EXPLANATION',
        prompt: 'When would you say buonasera?',
        expectedAnswers: [],
        expectedPoints: ['In the evening', 'As a greeting, not a goodbye'],
      },
      'When you meet someone at night',
    );

    expect(prompt).toContain('When would you say buonasera?');
    expect(prompt).toContain(
      '- In the evening\n- As a greeting, not a goodbye',
    );
    expect(prompt).toContain('When you meet someone at night');
  });
});
