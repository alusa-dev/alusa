import { describe, expect, it } from 'vitest';
import { clearAuthCookies } from '@/lib/auth-cookies';

describe('clearAuthCookies', () => {
  it('expira cookies fragmentados e ambas as variantes HTTP/HTTPS', () => {
    const response = clearAuthCookies(
      new Response(null),
      'next-auth.session-token.0=one; next-auth.session-token.1=two; __Secure-next-auth.session-token=secure',
    );
    const cookies = response.headers.get('set-cookie') ?? '';

    expect(cookies).toContain('next-auth.session-token.0=;');
    expect(cookies).toContain('next-auth.session-token.1=;');
    expect(cookies).toContain('__Secure-next-auth.session-token=;');
    expect(cookies).toContain('Secure');
  });
});
