import { describe, expect, it } from 'vitest';
import { swipeDirection } from './swipe';

describe('swipeDirection', () => {
  it('reads a drag to the left as a swipe left, and to the right as right', () => {
    expect(swipeDirection({ x: 300, y: 200 }, { x: 180, y: 210 })).toBe('left');
    expect(swipeDirection({ x: 100, y: 200 }, { x: 220, y: 190 })).toBe(
      'right',
    );
  });

  it('ignores a drag too short to be meant', () => {
    expect(swipeDirection({ x: 300, y: 200 }, { x: 260, y: 200 })).toBeNull();
  });

  it('ignores a drag that goes mostly up or down, such as scrolling', () => {
    expect(swipeDirection({ x: 300, y: 400 }, { x: 220, y: 200 })).toBeNull();
    expect(swipeDirection({ x: 300, y: 200 }, { x: 300, y: 400 })).toBeNull();
  });

  it('takes a long diagonal drag that goes further across than down', () => {
    expect(swipeDirection({ x: 300, y: 200 }, { x: 150, y: 250 })).toBe('left');
  });
});
