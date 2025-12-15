import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
// Provide DOM matchers for testing-library (e.g. toBeInTheDocument)
try { require('@testing-library/jest-dom'); } catch (e) { /* optional */ }

global.window = global.window || {};
// Minimal after-env setup: avoid redeclaring heavy mocks that exist in main __tests__.
global.window = global.window || {};
(global.window as any).__e2eEvents = [];

// jsdom doesn't implement Element.scrollIntoView; provide a harmless shim
if (typeof (HTMLElement.prototype as any).scrollIntoView !== 'function') {
  (HTMLElement.prototype as any).scrollIntoView = function() { /* no-op for tests */ };
}

afterEach(() => {
  try { jest.clearAllMocks(); } catch (e) {}
});

console.log('[JEST SETUP AFTER ENV] Minimal electron test hooks configured');
