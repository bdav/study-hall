import '@testing-library/jest-dom';

// Radix UI's Select uses pointer capture and scrolling, which jsdom lacks
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

// Radix UI's Tooltip measures its arrow, and jsdom has no ResizeObserver
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// jsdom doesn't scroll; the lesson page scrolls to the top of each new step
window.scrollTo = () => {};

// jsdom has no media queries; none match, as on a narrow screen
window.matchMedia ??= (query) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList;
