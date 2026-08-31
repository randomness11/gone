import { describe, expect, it } from 'vitest';
import { normalizeDomain, sanitizeTabForAI, sanitizeUrl } from '../privacy';

describe('privacy sanitization', () => {
  it('normalizes common mobile and www host prefixes', () => {
    expect(normalizeDomain('WWW.Reddit.COM')).toBe('reddit.com');
    expect(normalizeDomain('m.youtube.com')).toBe('youtube.com');
  });

  it('strips query parameters, fragments, and opaque path identifiers', () => {
    const result = sanitizeUrl('https://www.example.com/account/4f8ecbc0-3237-4f25-92fe-117932dbf129?token=sk_live_SOMETHING#email=test@example.com');
    expect(result.domain).toBe('example.com');
    expect(result.pathHint).toBe('/account/:redacted');
    expect(result.sanitizedUrl).not.toContain('?');
    expect(result.sanitizedUrl).not.toContain('#');
    expect(result.sanitizedUrl).not.toContain('token');
  });

  it('redacts emails and secret-like values from titles', () => {
    const tab = sanitizeTabForAI({
      title: 'Account for person@example.com — sk_live_12345678901234567890',
      url: 'https://example.com/settings',
      windowId: 1,
    });
    expect(tab.title).toContain('[email]');
    expect(tab.title).toContain('[redacted]');
    expect(tab.title).not.toContain('person@example.com');
  });

  it('marks browser-internal pages unsupported', () => {
    expect(sanitizeUrl('chrome://settings/privacy').unsupported).toBe(true);
  });

  it('keeps human-readable slugs but redacts mixed opaque document IDs', () => {
    expect(sanitizeUrl('https://shop.example.com/best-noise-cancelling-headphones').pathHint).toBe('/best-noise-cancelling-headphones');
    expect(sanitizeUrl('https://docs.google.com/document/d/1J3D7bf7120998791234567/edit').pathHint).toBe('/document/d/:redacted/edit');
  });

  it('hashes semantic query identity so different videos do not collapse together', () => {
    const first = sanitizeUrl('https://youtube.com/watch?v=first-video&utm_source=x');
    const second = sanitizeUrl('https://youtube.com/watch?v=second-video&utm_source=x');
    expect(first.pathHint).toMatch(/^\/watch\/:ref-/);
    expect(first.sanitizedUrl).not.toContain('first-video');
    expect(first.sanitizedUrl).not.toBe(second.sanitizedUrl);
  });
});
