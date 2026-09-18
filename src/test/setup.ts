import "@testing-library/jest-dom";
import i18n, { NAMESPACES } from "@/i18n/config";

// Browser builds load translation namespaces on demand. Tests render components
// synchronously, so make the same namespaces available before the suite starts.
await i18n.loadNamespaces(NAMESPACES);

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];

  constructor(_callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {}
  disconnect() {}
  observe(_target: Element) {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
  unobserve(_target: Element) {}
}

globalThis.IntersectionObserver = MockIntersectionObserver;
