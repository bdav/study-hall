import { Prisma, type PrismaClient } from '@prisma/client';

/**
 * Starts a fresh Tutor Thread on a Lesson Version, numbered after its
 * latest. It becomes the version's current thread, the one the tutor sees;
 * the earlier ones stay with the version (#62). A reply under way stays in
 * the thread it was asked in. Of two threads started at once, the unique
 * constraint lets one through, and both callers get it.
 */
export async function startTutorThread(
  prisma: PrismaClient,
  lessonVersionId: string,
) {
  const latest = await prisma.tutorThread.findFirst({
    where: { lessonVersionId },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  try {
    return await prisma.tutorThread.create({
      data: { lessonVersionId, number: (latest?.number ?? 0) + 1 },
      select: { id: true, number: true },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return prisma.tutorThread.findFirstOrThrow({
        where: { lessonVersionId },
        orderBy: { number: 'desc' },
        select: { id: true, number: true },
      });
    }
    throw error;
  }
}

/**
 * The Tutor Thread a message to the tutor joins: the version's current
 * one, or its first, created with the first message. Without nested writes
 * the upsert is one statement, so two first messages at once can't both
 * create it.
 */
export async function threadToAskIn(
  prisma: PrismaClient,
  lessonVersionId: string,
  current: { id: string } | undefined,
) {
  if (current) return current.id;
  const first = await prisma.tutorThread.upsert({
    where: { lessonVersionId_number: { lessonVersionId, number: 1 } },
    create: { lessonVersionId, number: 1 },
    update: {},
    select: { id: true },
  });
  return first.id;
}
