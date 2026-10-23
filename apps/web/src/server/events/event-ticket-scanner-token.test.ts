import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventTicketScannerToken, verifyEventTicketScannerToken } from './event-ticket-scanner-token';

describe('event ticket scanner capability token', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('regenerates the same signed capability without persisting the token', () => {
    vi.stubEnv('EVENT_TICKET_SCANNER_SECRET', 'scanner-secret-that-is-at-least-32-bytes-long');
    const first = createEventTicketScannerToken({ accessId: 'access-a', contaId: 'conta-a' });
    const second = createEventTicketScannerToken({ accessId: 'access-a', contaId: 'conta-a' });

    expect(first).toBe(second);
    expect(first).not.toContain('scanner-secret');
    expect(verifyEventTicketScannerToken(first)).toEqual({ version: 1, accessId: 'access-a', contaId: 'conta-a' });
  });

  it('rejects tampered claims and signatures', () => {
    vi.stubEnv('EVENT_TICKET_SCANNER_SECRET', 'scanner-secret-that-is-at-least-32-bytes-long');
    const token = createEventTicketScannerToken({ accessId: 'access-a', contaId: 'conta-a' });
    const [payload, signature] = token.split('.');
    const changedPayload = Buffer.from(JSON.stringify({ version: 1, accessId: 'access-a', contaId: 'conta-b' })).toString('base64url');

    expect(verifyEventTicketScannerToken(`${changedPayload}.${signature}`)).toBeNull();
    expect(verifyEventTicketScannerToken(`${payload}.${'A'.repeat(signature.length)}`)).toBeNull();
    expect(verifyEventTicketScannerToken(`${token}.extra`)).toBeNull();
  });

  it('fails closed when no sufficiently strong signing secret is configured', () => {
    vi.stubEnv('EVENT_TICKET_SCANNER_SECRET', 'short');
    vi.stubEnv('NEXTAUTH_SECRET', '');

    expect(() => createEventTicketScannerToken({ accessId: 'access-a', contaId: 'conta-a' })).toThrow(/32 bytes/);
  });
});
