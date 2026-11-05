/**
 * Whether an email is on an allowlist kept in an environment variable:
 * comma-separated, trimmed and case-insensitive. An unset list holds nobody.
 */
export function isOnAllowlist(
  allowlist: string | undefined,
  email: string,
): boolean {
  return (allowlist ?? '')
    .split(',')
    .map((listed) => listed.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

/**
 * The single check for whether an email may make an account, from
 * `SIGNUP_ALLOWED_EMAILS`. It's apart from AI access (`canUseAI`): being on
 * one allowlist never grants the other.
 */
export function canSignUp(email: string): boolean {
  return isOnAllowlist(process.env.SIGNUP_ALLOWED_EMAILS, email);
}
