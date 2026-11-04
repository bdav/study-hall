import { describe, expect, it } from 'vitest';
import { anchorLift } from './cardAnchor';

describe("lifting a study card's main text onto its anchor line", () => {
  it("doesn't lift one line, whose middle is on the line already", () => {
    expect(anchorLift({ textHeight: 36, lineHeight: 36, room: 80 })).toBe(0);
  });

  it('lifts text of several lines by half its height past the first', () => {
    expect(anchorLift({ textHeight: 108, lineHeight: 36, room: 80 })).toBe(36);
  });

  it('lifts no further than the room above it', () => {
    expect(anchorLift({ textHeight: 252, lineHeight: 36, room: 50 })).toBe(50);
  });

  it('never lowers it, however little room there is', () => {
    expect(anchorLift({ textHeight: 108, lineHeight: 36, room: -10 })).toBe(0);
  });
});
