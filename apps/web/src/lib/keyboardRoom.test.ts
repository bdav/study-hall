import { describe, expect, it } from 'vitest';
import { keyboardRoom } from './keyboardRoom';

describe('keyboardRoom', () => {
  it('gives the height left visible above an on-screen keyboard', () => {
    // An iPhone's Safari, 664 tall, with its keyboard open
    expect(
      keyboardRoom({ windowHeight: 664, viewport: { height: 340, scale: 1 } }),
    ).toBe(340);
  });

  it('gives none while nothing takes more than a toolbar from the window', () => {
    expect(
      keyboardRoom({ windowHeight: 664, viewport: { height: 664, scale: 1 } }),
    ).toBeNull();
    expect(
      keyboardRoom({ windowHeight: 664, viewport: { height: 560, scale: 1 } }),
    ).toBeNull();
  });

  it('gives none while the page is zoomed in, which shrinks what is visible too', () => {
    expect(
      keyboardRoom({ windowHeight: 664, viewport: { height: 332, scale: 2 } }),
    ).toBeNull();
  });

  it('gives none without a visual viewport', () => {
    expect(keyboardRoom({ windowHeight: 664, viewport: null })).toBeNull();
  });
});
