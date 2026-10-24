/**
 * Judge evaluation: runs the exercise judge on fixed cases with real model
 * calls and reports whether each evaluation is the expected one. It checks
 * the evaluation prompts, which the fake provider in the test suite can't,
 * and compares models. Not part of the test suite.
 *
 *   pnpm judge-eval:op [model]
 *
 * Calls are made as the user in `JUDGE_EVAL_EMAIL` (default the seeded
 * dev@example.com) and recorded like any other, so they count toward the
 * monthly AI spending cap. A full run costs a few cents.
 */
import { prisma } from '../db.js';
import { userCanUseAI } from './access.js';
import { createAnthropicProvider } from './anthropicProvider.js';
import {
  EXERCISE_EVALUATION_MODEL,
  judgeAnswer,
} from './exerciseEvaluation.js';
import { JUDGE_CASES } from './judgeEvalCases.js';
import { estimateCostUsd, isAiPaused, isPricedModel } from './spend.js';

async function main() {
  const model = process.argv[2] ?? EXERCISE_EVALUATION_MODEL;
  if (!isPricedModel(model)) {
    throw new Error(`${model} isn't in the price table in spend.ts`);
  }

  const email = process.env.JUDGE_EVAL_EMAIL ?? 'dev@example.com';
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No user ${email}; run pnpm db:seed`);
  // The same checks the app makes before a judge call
  if (!(await userCanUseAI(prisma, user.id))) {
    throw new Error(`${email} isn't in AI_ALLOWED_EMAILS`);
  }
  if (await isAiPaused(prisma)) {
    throw new Error("This month's AI spending cap has been reached");
  }

  const ai = createAnthropicProvider();
  const startedAt = new Date();
  let misses = 0;

  console.log(`Judging ${JUDGE_CASES.length} cases with ${model}\n`);
  for (const judgeCase of JUDGE_CASES) {
    try {
      const judged = await judgeAnswer(
        { prisma, ai, userId: user.id },
        judgeCase.exercise,
        judgeCase.answer,
        model,
      );
      const hit = judgeCase.expected.includes(judged.evaluation);
      if (!hit) misses++;

      console.log(
        `${hit ? 'PASS' : 'MISS'}  ${judgeCase.name}\n      expected ${judgeCase.expected.join(' or ')}, got ${judged.evaluation}`,
      );
      if (!hit) {
        if ('assessment' in judged) {
          console.log(`      ${JSON.stringify(judged.assessment)}`);
        }
        console.log(`      feedback: ${judged.feedback}`);
      }
    } catch (error) {
      misses++;
      console.log(`FAIL  ${judgeCase.name}\n      ${String(error)}`);
    }
  }

  const usage = await prisma.aiUsage.findMany({
    where: {
      userId: user.id,
      purpose: 'EXERCISE_EVALUATION',
      createdAt: { gte: startedAt },
    },
  });
  const cost = usage.reduce((total, call) => total + estimateCostUsd(call), 0);
  console.log(
    `\n${JUDGE_CASES.length - misses}/${JUDGE_CASES.length} as expected, estimated cost $${cost.toFixed(4)}`,
  );
  process.exitCode = misses > 0 ? 1 : 0;
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
