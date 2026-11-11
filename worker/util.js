// Shared helpers for the Worker's routes.

// Constant-time comparison of a request's key against a secret, so the time taken leaks nothing about how
// much of the key matched. A missing key or secret never matches.
export async function keyMatches(given, expected) {
  if (!given || !expected) return false;
  const encoder = new TextEncoder();
  const a = encoder.encode(given);
  const b = encoder.encode(cleanSecret(expected));
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

// A secret as pasted into `wrangler secret put`, without the surrounding whitespace or quotes a paste can carry
// along with it.
export function cleanSecret(value) {
  return String(value).trim().replace(/^(["'`])(.*)\1$/s, "$2").trim();
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
