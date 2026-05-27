import { createHash } from 'node:crypto';

export function hashPrivacyEvidence(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;

  const salt = process.env.PRIVACY_EVIDENCE_HASH_SECRET ?? process.env.NEXTAUTH_SECRET ?? 'alusa-privacy-evidence';
  return createHash('sha256').update(`${salt}:${normalized}`).digest('hex');
}

export function requestEvidence(req: Request) {
  const ip =
    req.headers.get('x-real-ip') ??
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null;
  const userAgent = req.headers.get('user-agent');

  return {
    ipHash: hashPrivacyEvidence(ip),
    userAgentHash: hashPrivacyEvidence(userAgent),
  };
}
