import { afterEach, describe, expect, it } from 'vitest';
import { buildPublicAppUrl, getAppBaseUrl, getInviteBaseUrl } from '@/lib/app-url';

const originalNextAuthUrl = process.env.NEXTAUTH_URL;
const originalPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;
const originalAppUrl = process.env.APP_URL;
const originalInviteBaseUrl = process.env.INVITE_BASE_URL;
const originalVercelUrl = process.env.VERCEL_URL;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalNextAuthUrl === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = originalNextAuthUrl;

  if (originalPublicAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = originalPublicAppUrl;

  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;

  if (originalInviteBaseUrl === undefined) delete process.env.INVITE_BASE_URL;
  else process.env.INVITE_BASE_URL = originalInviteBaseUrl;

  if (originalVercelUrl === undefined) delete process.env.VERCEL_URL;
  else process.env.VERCEL_URL = originalVercelUrl;

  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

describe('getAppBaseUrl', () => {
  it('prefers the auth server URL over stale public and generic URLs', () => {
    process.env.NEXTAUTH_URL = 'http://10.0.0.102:3000/';
    process.env.NEXT_PUBLIC_APP_URL = 'https://offline-tunnel.ngrok-free.dev';
    process.env.APP_URL = 'https://another-stale-url.example';

    expect(getAppBaseUrl()).toBe('http://10.0.0.102:3000');
  });

  it('falls back to the public URL when the auth URL is not configured', () => {
    delete process.env.NEXTAUTH_URL;
    process.env.NEXT_PUBLIC_APP_URL = 'https://alusa.app/';

    expect(getAppBaseUrl()).toBe('https://alusa.app');
  });

  it('uses the configured public invite URL instead of the private NextAuth address', () => {
    process.env.NODE_ENV = 'development';
    process.env.NEXTAUTH_URL = 'http://10.0.0.102:3000';
    process.env.NEXT_PUBLIC_APP_URL = 'https://stale-public.example.com';
    process.env.APP_URL = 'https://another.example.com';
    process.env.INVITE_BASE_URL = 'https://events.example.com/';

    expect(getInviteBaseUrl()).toBe('https://events.example.com');
  });

  it('builds email action links with the local public origin, not the LAN NextAuth URL', () => {
    process.env.NODE_ENV = 'development';
    process.env.NEXTAUTH_URL = 'http://10.0.0.102:3000';
    process.env.INVITE_BASE_URL = 'http://localhost:3000';

    expect(buildPublicAppUrl('/auth/verify-email?token=opaque')).toBe(
      'http://localhost:3000/auth/verify-email?token=opaque',
    );
  });

  it('defaults local invite links to localhost instead of the machine LAN address', () => {
    process.env.NODE_ENV = 'development';
    process.env.NEXT_PUBLIC_APP_URL = 'https://stale-public.example.com';
    delete process.env.INVITE_BASE_URL;
    process.env.NEXTAUTH_URL = 'http://10.0.0.102:3000';

    expect(getInviteBaseUrl()).toBe('http://localhost:3000');
  });

  it('uses localhost for local invite links even when public environment URLs are stale', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.INVITE_BASE_URL;
    process.env.NEXT_PUBLIC_APP_URL = 'https://stale-tunnel.ngrok-free.dev';
    process.env.APP_URL = 'https://stale-tunnel.ngrok-free.dev';
    process.env.NEXTAUTH_URL = 'http://10.0.0.102:3000';

    expect(getInviteBaseUrl()).toBe('http://localhost:3000');
  });

  it('allows localhost over HTTP only in development', () => {
    process.env.NODE_ENV = 'development';
    process.env.INVITE_BASE_URL = 'http://localhost:3000/';

    expect(getInviteBaseUrl()).toBe('http://localhost:3000');
  });

  it('requires a public HTTPS origin in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.INVITE_BASE_URL = 'http://localhost:3000';

    expect(() => getInviteBaseUrl()).toThrow(/domínio público HTTPS/i);
  });
});
