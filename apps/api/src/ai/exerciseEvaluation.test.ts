import { describe, it, expect } from 'vitest';
import {
  buildEvaluationPrompt,
  evaluateExplanation,
  explanationAssessmentSchema,
  shortAnswerEvaluationSchema,
} from './exerciseEvaluation.js';

describe('shortAnswerEvaluationSchema', () => {
  const validOutput = {
    evaluation: 'CORRECT',
    feedback: 'Right: "Come va?" is a natural way to ask how someone is.',
  };

  it.each(['CORRECT', 'INCORRECT'])(
    'accepts a %s evaluation with feedback',
    (evaluation) => {
      const output = { ...validOutput, evaluation };

      expect(shortAnswerEvaluationSchema.parse(output)).toEqual(output);
    },
  );

  it.each([
    // Partially correct is for free-form explanations only (ADR-0006)
    [
      'a partially correct evaluation',
      { ...validOutput, evaluation: 'PARTIALLY_CORRECT' },
    ],
    ['an unknown evaluation', { ...validOutput, evaluation: 'PARTIAL' }],
    ['a missing evaluation', { feedback: validOutput.feedback }],
    ['blank feedback', { ...validOutput, feedback: '  ' }],
    ['missing feedback', { evaluation: 'CORRECT' }],
  ])('rejects %s', (_, output) => {
    expect(shortAnswerEvaluationSchema.safeParse(output).success).toBe(false);
  });

  it('trims the feedback', () => {
    expect(
      shortAnswerEvaluationSchema.parse({
        ...validOutput,
        feedback: ' Right. ',
      }).feedback,
    ).toBe('Right.');
  });
});

describe('explanationAssessmentSchema', () => {
  const validOutput = {
    points: [
      {
        point: 'Direct pronouns before the verb trigger agreement',
        evidence: 'Says le stands for le amiche, so viste agrees',
        status: 'DEMONSTRATED',
      },
      {
        point: 'Indirect pronouns never do',
        evidence: 'Says nothing about le ho scritto',
        status: 'MISSING',
      },
    ],
    misconceptions: [],
    feedback: 'You explain the direct case well. What about "Le ho scritto"?',
  };

  it('accepts an assessment of each essential point, misconceptions and feedback', () => {
    expect(explanationAssessmentSchema(2).parse(validOutput)).toEqual(
      validOutput,
    );
  });

  it.each([
    [
      'one point too few',
      { ...validOutput, points: validOutput.points.slice(0, 1) },
    ],
    [
      'one point too many',
      {
        ...validOutput,
        points: [
          ...validOutput.points,
          { point: 'Ne', evidence: 'Not mentioned', status: 'MISSING' },
        ],
      },
    ],
    [
      'an unknown status',
      {
        ...validOutput,
        points: [
          validOutput.points[0],
          { point: 'Indirect', evidence: 'Half of it', status: 'HALF' },
        ],
      },
    ],
    [
      'a point without evidence',
      {
        ...validOutput,
        points: [
          validOutput.points[0],
          { point: 'Indirect pronouns never do', status: 'MISSING' },
        ],
      },
    ],
    ['missing misconceptions', { ...validOutput, misconceptions: undefined }],
    ['blank feedback', { ...validOutput, feedback: ' ' }],
  ])('rejects %s', (_, output) => {
    expect(explanationAssessmentSchema(2).safeParse(output).success).toBe(
      false,
    );
  });

  it('takes one to three points the judge identifies itself when the exercise has no essential points', () => {
    const schema = explanationAssessmentSchema();

    expect(schema.safeParse(validOutput).success).toBe(true);
    expect(schema.safeParse({ ...validOutput, points: [] }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({
        ...validOutput,
        points: Array.from({ length: 4 }, () => validOutput.points[0]),
      }).success,
    ).toBe(false);
  });
});

describe('evaluateExplanation', () => {
  const point = (status: 'DEMONSTRATED' | 'MISSING' | 'WRONG') => ({
    point: 'A point',
    evidence: 'What the answer says',
    status,
  });

  it.each([
    [
      'every essential point demonstrated',
      ['DEMONSTRATED', 'DEMONSTRATED'],
      [],
      'CORRECT',
    ],
    [
      'one essential point missing',
      ['DEMONSTRATED', 'MISSING'],
      [],
      'PARTIALLY_CORRECT',
    ],
    [
      'one essential point wrong',
      ['DEMONSTRATED', 'WRONG'],
      [],
      'PARTIALLY_CORRECT',
    ],
    [
      'every point demonstrated but a misconception',
      ['DEMONSTRATED', 'DEMONSTRATED'],
      ['Says indirect pronouns agree after elision'],
      'PARTIALLY_CORRECT',
    ],
    ['no essential point demonstrated', ['MISSING', 'WRONG'], [], 'INCORRECT'],
  ] as const)('is %s', (_, statuses, misconceptions, evaluation) => {
    expect(
      evaluateExplanation({
        points: statuses.map(point),
        misconceptions: [...misconceptions],
      }),
    ).toBe(evaluation);
  });
});

describe('buildEvaluationPrompt', () => {
  it('sends a short answer with its expected answers and the learner answer', () => {
    const prompt = buildEvaluationPrompt(
      {
        type: 'SHORT_ANSWER',
        prompt: 'Translate: How are you?',
        expectedAnswers: ['Come stai?', 'Come sta?'],
        essentialPoints: [],
        supplementaryPoints: [],
        expectedPoints: [],
      },
      'Come va?',
    );

    expect(prompt).toContain('Translate: How are you?');
    expect(prompt).toContain('- Come stai?\n- Come sta?');
    expect(prompt).toContain('Come va?');
    expect(prompt).not.toMatch(/points/i);
  });

  it('sends a free-form explanation with its essential and supplementary points', () => {
    const prompt = buildEvaluationPrompt(
      {
        type: 'FREE_FORM_EXPLANATION',
        prompt: 'When would you say buonasera?',
        expectedAnswers: [],
        essentialPoints: ['It greets someone in the evening'],
        supplementaryPoints: ['Buonanotte is for parting at night'],
        expectedPoints: [],
      },
      'When you meet someone at night',
    );

    expect(prompt).toContain('When would you say buonasera?');
    expect(prompt).toMatch(
      /Essential points[^\n]*:\n1\. It greets someone in the evening/,
    );
    expect(prompt).toMatch(
      /Supplementary points[^\n]*:\n- Buonanotte is for parting at night/,
    );
    expect(prompt).toContain('When you meet someone at night');
  });

  it("sends an older explanation's flat points as reference only, for the judge to find the essentials in the question", () => {
    const prompt = buildEvaluationPrompt(
      {
        type: 'FREE_FORM_EXPLANATION',
        prompt: 'When would you say buonasera?',
        expectedAnswers: [],
        essentialPoints: [],
        supplementaryPoints: [],
        expectedPoints: ['In the evening', 'As a greeting, not a goodbye'],
      },
      'When you meet someone at night',
    );

    expect(prompt).not.toMatch(/Essential points/);
    expect(prompt).toMatch(
      /Reference points[^\n]*not all required[^\n]*:\n- In the evening\n- As a greeting, not a goodbye/i,
    );
  });
});
