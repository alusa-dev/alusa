import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Invite from './invite-service';

describe('invite-service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('createInvite cria com expiração ~72h', async () => {
    // Mock prisma
    const now = Date.now();
    vi.useFakeTimers().setSystemTime(new Date(now));
    const findFirst = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: '1', ...data, createdAt: new Date() }));
    // @ts-expect-error monkey patch
    Invite['prisma'] = { invite: { findFirst, create } };

    const out = await Invite.createInvite('a@a.com', 'RECEPCAO', 'admin-1');
    expect(out.email).toBe('a@a.com');

  const diff = (out.expiresAt.getTime() - now) / (60 * 60 * 1000);
  // tolerância levemente maior para ambientes lentos/CI
  expect(diff).toBeGreaterThan(71.8);
  expect(diff).toBeLessThan(72.2);
  });
});
