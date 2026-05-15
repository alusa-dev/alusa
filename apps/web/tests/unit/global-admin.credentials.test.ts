/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  getGlobalAdminAuthConfig,
  validateGlobalAdminCredentials,
} from '@/features/global-admin/auth/credentials.server';

describe('global admin credentials', () => {
  afterEach(() => {
    delete process.env.GLOBAL_ADMIN_USERNAME;
    delete process.env.GLOBAL_ADMIN_PASSWORD;
    delete process.env.GLOBAL_ADMIN_SESSION_SECRET;
    delete process.env.NEXTAUTH_SECRET;
  });

  it('valida utilizador sem distinguir maiúsculas/minúsculas', () => {
    process.env.GLOBAL_ADMIN_USERNAME = 'Alusa';
    process.env.GLOBAL_ADMIN_PASSWORD = 'secret-pass';
    process.env.GLOBAL_ADMIN_SESSION_SECRET = '0123456789abcdef';

    expect(validateGlobalAdminCredentials({ username: 'alusa', password: 'secret-pass' })).toBe(true);
    expect(validateGlobalAdminCredentials({ username: 'ALUSA', password: 'secret-pass' })).toBe(true);
    expect(validateGlobalAdminCredentials({ username: 'alusa', password: 'wrong' })).toBe(false);
  });

  it('remove espaços à volta da password nas variáveis de ambiente', () => {
    process.env.GLOBAL_ADMIN_USERNAME = 'admin';
    process.env.GLOBAL_ADMIN_PASSWORD = '  spaced-secret\n';
    process.env.GLOBAL_ADMIN_SESSION_SECRET = '0123456789abcdef';

    expect(getGlobalAdminAuthConfig().password).toBe('spaced-secret');
    expect(validateGlobalAdminCredentials({ username: 'admin', password: 'spaced-secret' })).toBe(true);
  });
});
