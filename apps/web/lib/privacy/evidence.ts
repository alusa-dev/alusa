import { createHash } from 'node:crypto';

function privacyEvidenceSalt(): string {
  const dedicatedSecret = process.env.PRIVACY_EVIDENCE_HASH_SECRET?.trim();
  if (dedicatedSecret) return dedicatedSecret;

  const legacySecret = process.env.NEXTAUTH_SECRET?.trim();
  if (legacySecret) return legacySecret;

  const production = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
  if (production) {
    throw new Error('PRIVACY_EVIDENCE_HASH_SECRET ou NEXTAUTH_SECRET ausente em produção.');
  }

  return 'alusa-privacy-evidence';
}

export function hashPrivacyEvidence(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;

  const salt = privacyEvidenceSalt();
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
