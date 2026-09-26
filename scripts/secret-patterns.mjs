/** Findings contain categories only. Never return or log the matching credential. */
export function secretFindings(text) {
  const findings = [];
  const patterns = [
    ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
    ['stripe_secret', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/],
    ['stripe_webhook', /\bwhsec_[A-Za-z0-9]{16,}\b/],
    ['supabase_secret', /\bsb_secret_[A-Za-z0-9_-]{16,}\b/],
    ['resend_secret', /\bre_[A-Za-z0-9_-]{20,}\b/],
    ['openai_secret', /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/],
    ['aws_access_key', /\bAKIA[A-Z0-9]{16}\b/],
    ['github_token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ];
  for (const [category, pattern] of patterns) {
    if (pattern.test(text)) findings.push(category);
  }
  // Legacy Supabase server credentials use JWTs. Public anonymous JWTs are not secrets;
  // service-role JWTs must be blocked even when their signature is not verified here.
  for (const [candidate] of text.matchAll(
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  )) {
    try {
      const payload = JSON.parse(
        Buffer.from(candidate.split('.')[1], 'base64url').toString('utf8'),
      );
      if (payload && typeof payload === 'object' && payload.role === 'service_role') {
        findings.push('supabase_service_role');
        break;
      }
    } catch {
      // Not a parseable legacy credential; other credential patterns still apply.
    }
  }
  return findings;
}
