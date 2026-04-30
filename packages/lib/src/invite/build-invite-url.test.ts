import { describe, it, expect } from 'vitest';
import { buildInviteUrl } from './build-invite-url';

describe('buildInviteUrl', () => {
  it('monta a URL corretamente com base http e token válido', () => {
    const url = buildInviteUrl('http://localhost:3000', 'tok_1234567890');
    expect(url).toBe('http://localhost:3000/auth/register?token=tok_1234567890');
  });

  it('monta a URL corretamente com base https e token válido', () => {
    const url = buildInviteUrl('https://app.exemplo.com', 'tok_abcdefghij');
    expect(url).toBe('https://app.exemplo.com/auth/register?token=tok_abcdefghij');
  });

  it('falha se baseUrl não for uma URL absoluta', () => {
    expect(() => buildInviteUrl('/relativo', 'tok_1234567890')).toThrow();
  });

  it('falha se protocolo não for http(s)', () => {
    expect(() => buildInviteUrl('ftp://exemplo.com', 'tok_1234567890')).toThrow();
  });

  it('falha se token tiver menos de 10 caracteres', () => {
    expect(() => buildInviteUrl('https://app.exemplo.com', 'curto')).toThrow();
  });
});
