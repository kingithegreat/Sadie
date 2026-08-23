/**
 * The SearXNG URL reaching the search provider.
 *
 * A settings field that never reaches the thing it configures is this
 * codebase's characteristic bug, and it has two shapes here specifically: the
 * value is written on Save but not loaded at startup, or loaded at startup but
 * not refreshed on Save. Either way the user types a URL, nothing changes, and
 * there is no error to go on.
 *
 * So these assert the setter contract that both sync sites depend on, and the
 * normalisation that a hand-pasted URL needs.
 */

import { setSearxngUrl, getSearxngUrl } from '../tools/web';

afterEach(() => setSearxngUrl(null));

describe('SearXNG URL wiring', () => {
  test('a URL set is a URL the provider can read back', () => {
    setSearxngUrl('http://localhost:8080');
    expect(getSearxngUrl()).toBe('http://localhost:8080');
  });

  test('unset means unset — the provider must report itself unavailable', () => {
    setSearxngUrl('http://localhost:8080');
    setSearxngUrl(null);
    expect(getSearxngUrl()).toBeNull();
  });

  test('a trailing slash is removed', () => {
    // `${base}/search` against "http://host/" produces "http://host//search",
    // which some reverse proxies 404. This is pasted by hand, so it happens.
    setSearxngUrl('http://localhost:8080/');
    expect(getSearxngUrl()).toBe('http://localhost:8080');
  });

  test('several trailing slashes are removed', () => {
    setSearxngUrl('http://localhost:8080///');
    expect(getSearxngUrl()).toBe('http://localhost:8080');
  });

  test('surrounding whitespace is removed', () => {
    setSearxngUrl('  http://localhost:8080  ');
    expect(getSearxngUrl()).toBe('http://localhost:8080');
  });

  test('an empty string reads as not configured, not as an empty base URL', () => {
    // Settings serialise a cleared field as '' before it becomes undefined.
    // Treating that as configured would build "/search?q=…" and request the
    // local filesystem root.
    setSearxngUrl('');
    expect(getSearxngUrl()).toBeNull();
  });

  test('a path prefix survives — SearXNG behind a reverse proxy subpath', () => {
    setSearxngUrl('https://home.example.com/searx/');
    expect(getSearxngUrl()).toBe('https://home.example.com/searx');
  });
});
