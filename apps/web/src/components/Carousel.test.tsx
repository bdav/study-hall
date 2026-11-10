import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { Carousel, CarouselItem } from './Carousel';

/** jsdom lays nothing out, so a row's widths and scroll are set by hand. */
function layOut(
  row: HTMLElement,
  { clientWidth, scrollWidth, scrollLeft = 0 }: Record<string, number>,
) {
  Object.defineProperties(row, {
    clientWidth: { configurable: true, value: clientWidth },
    scrollWidth: { configurable: true, value: scrollWidth },
    scrollLeft: { configurable: true, writable: true, value: scrollLeft },
  });
}

function renderCarousel() {
  render(
    <Carousel label="Review">
      {['One', 'Two', 'Three'].map((name) => (
        <CarouselItem key={name}>{name}</CarouselItem>
      ))}
    </Carousel>,
  );
  return screen.getByRole('list', { name: 'Review' });
}

const back = () => screen.queryByRole('button', { name: 'Scroll Review back' });
const forward = () =>
  screen.queryByRole('button', { name: 'Scroll Review forward' });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Carousel', () => {
  it('lists its tiles', () => {
    const row = renderCarousel();

    expect(row.querySelectorAll('li')).toHaveLength(3);
  });

  it('offers no arrows while its tiles all fit', () => {
    const row = renderCarousel();
    layOut(row, { clientWidth: 900, scrollWidth: 900 });
    fireEvent.scroll(row);

    expect(back()).not.toBeInTheDocument();
    expect(forward()).not.toBeInTheDocument();
  });

  it('offers an arrow only toward the tiles out of view', () => {
    const row = renderCarousel();
    layOut(row, { clientWidth: 300, scrollWidth: 900 });
    fireEvent.scroll(row);
    expect(back()).not.toBeInTheDocument();
    expect(forward()).toBeInTheDocument();

    layOut(row, { clientWidth: 300, scrollWidth: 900, scrollLeft: 300 });
    fireEvent.scroll(row);
    expect(back()).toBeInTheDocument();
    expect(forward()).toBeInTheDocument();

    layOut(row, { clientWidth: 300, scrollWidth: 900, scrollLeft: 600 });
    fireEvent.scroll(row);
    expect(back()).toBeInTheDocument();
    expect(forward()).not.toBeInTheDocument();
  });

  it('pages by most of the width in view', () => {
    const row = renderCarousel();
    const scrollBy = vi.fn();
    row.scrollBy = scrollBy;
    layOut(row, { clientWidth: 300, scrollWidth: 900, scrollLeft: 300 });
    fireEvent.scroll(row);

    act(() => forward()!.click());
    expect(scrollBy).toHaveBeenLastCalledWith({ left: 270 });
    act(() => back()!.click());
    expect(scrollBy).toHaveBeenLastCalledWith({ left: -270 });
  });
});
