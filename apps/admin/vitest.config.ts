import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const appDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts'],
  },
  resolve: {
    alias: [
      { find: '@', replacement: appDir },
      { find: '@alusa/admin-auth/roles', replacement: path.resolve(appDir, '../../packages/admin-auth/src/roles.ts') },
      { find: '@alusa/admin-auth', replacement: path.resolve(appDir, '../../packages/admin-auth/src/index.ts') },
    ],
  },
});
