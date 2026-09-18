import { afterEach, describe, expect, it, vi } from 'vitest';

import { hashPrivacyEvidence } from '@/lib/privacy/evidence';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('privacy evidence hashing', () => {
  it('produz hash determinístico com segredo dedicado', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('PRIVACY_EVIDENCE_HASH_SECRET', 'dedicated-secret');

    expect(hashPrivacyEvidence('  user@example.com ')).toBe(hashPrivacyEvidence('user@example.com'));
    expect(hashPrivacyEvidence('user@example.com')).toHaveLength(64);
  });

  it('mantém o fallback controlado fora de produção', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('PRIVACY_EVIDENCE_HASH_SECRET', '');
    vi.stubEnv('NEXTAUTH_SECRET', '');

    expect(hashPrivacyEvidence('user@example.com')).toBeTruthy();
  });

  it('falha fechado em produção sem segredo de evidência ou sessão', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('PRIVACY_EVIDENCE_HASH_SECRET', '');
    vi.stubEnv('NEXTAUTH_SECRET', '');

    expect(() => hashPrivacyEvidence('user@example.com')).toThrow(/PRIVACY_EVIDENCE_HASH_SECRET/);
  });

  it('preserva compatibilidade com o segredo de sessão até a migração do segredo dedicado', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('PRIVACY_EVIDENCE_HASH_SECRET', '');
    vi.stubEnv('NEXTAUTH_SECRET', 'session-secret');

    expect(hashPrivacyEvidence('user@example.com')).toBeTruthy();
  });
});
