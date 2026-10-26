import '@testing-library/jest-dom';

// Radix UI's Select uses pointer capture and scrolling, which jsdom lacks
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};
