const SECRET_PATTERNS = [
  /nskey_(?:live|test)_[A-Za-z0-9]+/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /(access_token["']?\s*[:=]\s*["'])[^\s"']+(["'])/gi,
  /(refresh_token["']?\s*[:=]\s*["'])[^\s"']+(["'])/gi
];

export function redact(value: string): string {
  return SECRET_PATTERNS.reduce((text, pattern) => {
    if (pattern.source.includes("access_token") || pattern.source.includes("refresh_token")) {
      return text.replace(pattern, "$1[redacted]$2");
    }
    return text.replace(pattern, (match) => `${match.slice(0, 14)}...[redacted]`);
  }, value);
}
