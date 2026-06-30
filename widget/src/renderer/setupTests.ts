import '@testing-library/jest-dom';

// Polyfill scrollIntoView for JSDOM (missing DOM API)
if (typeof window !== 'undefined' && !window.HTMLElement.prototype.scrollIntoView) {
  // @ts-ignore - jsdom doesn't declare scrollIntoView by default
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

// Provide a minimal window.electron so tests can override as needed.
if (typeof window !== 'undefined' && !(window as any).electron) {
  (window as any).electron = {};
}
