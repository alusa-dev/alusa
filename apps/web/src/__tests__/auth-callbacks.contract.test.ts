import { describe, it, expect } from 'vitest';
import { authOptions } from '@/lib/auth-options';
import type { JWT } from 'next-auth/jwt';
import type { Session, User, Account, Profile } from 'next-auth';

describe('auth callbacks contract', () => {
  it('propaga campos no jwt e session', async () => {
  const user: User = { id: 'u1', email: 'a@a.com', name: 'A', role: 'ADMIN', contaId: null } as User;
  const token: JWT = {};
  const account: Account | null = null;
  const profile: Profile | undefined = undefined;
  const jwtCb = authOptions.callbacks?.jwt as (args: { token: JWT; user: User; account: Account | null; profile?: Profile }) => Promise<JWT> | JWT;
  const jwtOut = await jwtCb({ token, user, account, profile });
  expect(jwtOut.id).toBe('u1');
  const sessionBase: Session = { user: { id: '', email: '', name: '', role: '', contaId: null }, expires: new Date().toISOString() } as Session;
    const sessionCb = authOptions.callbacks?.session as unknown as (args: {
      session: Session;
      token: JWT;
      user?: User;
    }) => Promise<Session> | Session;
  const sessionOut = await sessionCb({ session: sessionBase, token: jwtOut });
  expect(sessionOut.user).toMatchObject({ id: 'u1', email: 'a@a.com', role: 'ADMIN' });
  });
});
