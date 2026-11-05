import { type PrismaClient } from '@prisma/client';
import { isOnAllowlist } from '../auth/allowlist.js';

/**
 * The single check for whether a user may use AI-backed features. v1 reads
 * an email allowlist from `AI_ALLOWED_EMAILS` (comma-separated); nothing
 * else reads the allowlist.
 */
export function canUseAI(user: { email: string }): boolean {
  return isOnAllowlist(process.env.AI_ALLOWED_EMAILS, user.email);
}

/** Whether a signed-in user, looked up by id, passes `canUseAI`. */
export async function userCanUseAI(
  prisma: PrismaClient,
  userId: string,
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  return user !== null && canUseAI(user);
}

export const AI_ACCESS_DENIED_MESSAGE =
  "Your account doesn't have access to AI features, which courses need. Standalone flashcards are still available.";
