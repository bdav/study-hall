/**
 * The single check for whether a user may use AI-backed features. v1 reads
 * an email allowlist from `AI_ALLOWED_EMAILS` (comma-separated); nothing
 * else reads the allowlist.
 */
export function canUseAI(user: { email: string }): boolean {
  const allowed = (process.env.AI_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  return allowed.includes(user.email.toLowerCase());
}

export const AI_ACCESS_DENIED_MESSAGE =
  "Your account doesn't have access to AI features, which courses need. Standalone flashcards are still available.";
