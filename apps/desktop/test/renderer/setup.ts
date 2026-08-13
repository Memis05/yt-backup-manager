import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

class RendererTestResizeObserver {
  public disconnect(): void {
    // jsdom has no layout engine, so observed geometry never changes.
  }

  public observe(): void {
    // jsdom has no layout engine, so observed geometry never changes.
  }

  public unobserve(): void {
    // jsdom has no layout engine, so observed geometry never changes.
  }
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: RendererTestResizeObserver,
});

Object.defineProperty(globalThis, 'matchMedia', {
  configurable: true,
  value: (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

Object.defineProperties(HTMLElement.prototype, {
  scrollIntoView: {
    configurable: true,
    value: () => undefined,
  },
  hasPointerCapture: {
    configurable: true,
    value: () => false,
  },
  setPointerCapture: {
    configurable: true,
    value: () => undefined,
  },
  releasePointerCapture: {
    configurable: true,
    value: () => undefined,
  },
});

afterEach(() => cleanup());
