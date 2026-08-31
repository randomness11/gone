import type { RawTab, SanitizedTab } from '../types';

const HEX_OR_UUID = /^(?:[a-f\d]{24,}|[a-f\d-]{32,})$/i;
const MIXED_OPAQUE = /^(?=.{20,}$)(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d_-]+$/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SECRET = /\b(?:sk|pk|api|key|token|secret)[-_]?[A-Za-z0-9_-]{12,}\b/gi;
const SENSITIVE_WORDS = /(?:token|secret|password|passwd|auth|api[_-]?key|session|signature|credential)/i;
const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);

export function normalizeDomain(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '').replace(/\.$/, '');
}

export function redactText(value: string): string {
  return value.replace(EMAIL, '[email]').replace(SECRET, '[redacted]').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function looksOpaque(value: string): boolean {
  return HEX_OR_UUID.test(value) || MIXED_OPAQUE.test(value) || /^[A-Za-z\d]{28,}$/.test(value);
}

function cleanPath(pathname: string): string {
  const segments = pathname
    .split('/')
    .filter(Boolean)
    .slice(0, 6)
    .map((part) => {
      let decoded = part;
      try {
        decoded = decodeURIComponent(part);
      } catch {
        // Keep the encoded value if it is malformed.
      }
      const cleaned = redactText(decoded);
      if (looksOpaque(cleaned) || SENSITIVE_WORDS.test(cleaned) || /^\d{7,}$/.test(cleaned)) {
        return ':redacted';
      }
      return cleaned.slice(0, 56);
    });
  return segments.length ? `/${segments.join('/')}` : '';
}

function semanticQueryHint(parsed: URL): string {
  const safeIdentityKeys = ['v', 'id', 'item'];
  for (const key of safeIdentityKeys) {
    const value = parsed.searchParams.get(key);
    if (value && !SENSITIVE_WORDS.test(key)) return `/:ref-${stableHash(value).slice(0, 6)}`;
  }
  return '';
}

export function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

export function sanitizeUrl(rawUrl?: string): {
  domain: string;
  pathHint: string;
  sanitizedUrl: string;
  unsupported: boolean;
} {
  if (!rawUrl) {
    return { domain: 'unknown', pathHint: '', sanitizedUrl: '', unsupported: true };
  }

  try {
    const parsed = new URL(rawUrl);
    if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
      return {
        domain: parsed.protocol.replace(':', '') || 'browser',
        pathHint: '',
        sanitizedUrl: `${parsed.protocol}//`,
        unsupported: true,
      };
    }

    const domain = normalizeDomain(parsed.hostname);
    const pathHint = `${cleanPath(parsed.pathname)}${semanticQueryHint(parsed)}`;
    return {
      domain,
      pathHint,
      sanitizedUrl: `${parsed.protocol}//${domain}${pathHint}`,
      unsupported: false,
    };
  } catch {
    return { domain: 'unknown', pathHint: '', sanitizedUrl: '', unsupported: true };
  }
}

export function sanitizeTabForAI(tab: RawTab, position = 0, now = Date.now()): SanitizedTab {
  const url = sanitizeUrl(tab.url);
  const title = redactText(tab.title || (url.unsupported ? 'Browser page' : url.domain) || 'Untitled tab');
  const urlHash = stableHash(url.sanitizedUrl || `${title}:${tab.windowId}:${position}`);
  const ageHours = tab.lastAccessed ? Math.max(0, (now - tab.lastAccessed) / 3_600_000) : undefined;

  return {
    id: `tab_${position + 1}_${urlHash.slice(0, 4)}`,
    browserTabId: tab.id,
    title,
    domain: url.domain,
    pathHint: url.pathHint,
    sanitizedUrl: url.sanitizedUrl,
    urlHash,
    windowId: tab.windowId,
    groupId: tab.groupId ?? -1,
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    openerTabId: tab.openerTabId,
    lastAccessed: tab.lastAccessed,
    ageHours,
    unsupported: url.unsupported,
  };
}
