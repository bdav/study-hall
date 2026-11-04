/**
 * How far to lift a study card's main text so its middle, not its first
 * line, sits on the card's anchor line (#123): half its height past one
 * line, as far as the room above it allows, and never lower.
 */
export function anchorLift({
  textHeight,
  lineHeight,
  room,
}: {
  textHeight: number;
  lineHeight: number;
  room: number;
}) {
  return Math.max(0, Math.min((textHeight - lineHeight) / 2, room));
}
