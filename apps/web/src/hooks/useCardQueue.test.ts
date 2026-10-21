import { renderHook, act } from '@testing-library/react';
import { useCardQueue } from './useCardQueue';

const cards = [
  { id: 'card-1', front: 'What is 2+2?', canonicalAnswer: '4' },
  { id: 'card-2', front: 'Capital of France?', canonicalAnswer: 'Paris' },
  { id: 'card-3', front: 'Color of sky?', canonicalAnswer: 'Blue' },
];

describe('useCardQueue', () => {
  it('starts with an empty queue', () => {
    const { result } = renderHook(() => useCardQueue(cards));

    expect(result.current.queue).toEqual([]);
    expect(result.current.currentCard).toBeNull();
    expect(result.current.cardsStudied).toBe(0);
  });

  it('populates queue on reset', () => {
    const { result } = renderHook(() => useCardQueue(cards));

    act(() => result.current.reset());

    expect(result.current.queue).toHaveLength(3);
    expect(result.current.currentCard).toEqual(cards[0]);
    expect(result.current.cardsStudied).toBe(0);
  });

  it('advances to the next card without re-queuing', () => {
    const { result } = renderHook(() => useCardQueue(cards));

    act(() => result.current.reset());
    act(() => result.current.advance(false));

    expect(result.current.currentCard).toEqual(cards[1]);
    expect(result.current.queue).toHaveLength(2);
    expect(result.current.cardsStudied).toBe(1);
  });

  it('re-queues the current card to the back when advance(true)', () => {
    const { result } = renderHook(() => useCardQueue(cards));

    act(() => result.current.reset());
    act(() => result.current.advance(true));

    expect(result.current.currentCard).toEqual(cards[1]);
    expect(result.current.queue).toHaveLength(3);
    expect(result.current.queue[2]).toEqual(cards[0]);
    expect(result.current.cardsStudied).toBe(1);
  });

  it('empties the queue after advancing through all cards', () => {
    const { result } = renderHook(() => useCardQueue(cards));

    act(() => result.current.reset());
    act(() => result.current.advance(false));
    act(() => result.current.advance(false));
    act(() => result.current.advance(false));

    expect(result.current.queue).toHaveLength(0);
    expect(result.current.currentCard).toBeNull();
    expect(result.current.cardsStudied).toBe(3);
  });

  it('resets cardsStudied and queue on subsequent reset', () => {
    const { result } = renderHook(() => useCardQueue(cards));

    act(() => result.current.reset());
    act(() => result.current.advance(false));
    act(() => result.current.advance(false));
    act(() => result.current.reset());

    expect(result.current.queue).toHaveLength(3);
    expect(result.current.currentCard).toEqual(cards[0]);
    expect(result.current.cardsStudied).toBe(0);
  });
});
