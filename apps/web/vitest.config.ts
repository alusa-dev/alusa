import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    passWithNoTests: true,
    // ⚠️ IMPORTANTE: Define NODE_ENV=test para garantir uso do banco de teste
    env: {
      NODE_ENV: 'test',
    },
    // Coverage habilitado somente em CI para evitar crashes intermitentes no Windows local
    coverage: { enabled: process.env.CI === 'true', provider: 'v8' },
    sequence: { concurrent: false },
    // Usa processos fork em vez de threads para evitar segfault no Windows (Node 22)
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    deps: {
      inline: [/^@alusa\/lib/, /^@alusa\/finance/, /^@alusa\/database/],
    },
    include: [
      'src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'tests/unit/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'tests/**/*password-policy.test.ts',
      'features/**/__tests__/*.{test,spec}.?(c|m)[jt]s?(x)',
      'app/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'app/**/__tests__/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    setupFiles: [path.resolve(__dirname, 'tests', 'setup.ts')],
  },
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: [
      { find: './app/globals.css', replacement: path.resolve(__dirname, 'vitest-empty.css') },
      { find: '@/prisma/client', replacement: path.resolve(__dirname, 'src', 'prisma.ts') },
      {
        find: /^@alusa\/lib(.*)$/,
        replacement: path.resolve(__dirname, '..', '..', 'packages', 'lib', 'src') + '$1',
      },
      {
        find: /^@alusa\/finance(.*)$/,
        replacement: path.resolve(__dirname, '..', '..', 'packages', 'finance', 'src') + '$1',
      },
      {
        find: /^@alusa\/database(.*)$/,
        replacement: path.resolve(__dirname, '..', '..', 'packages', 'database', 'src') + '$1',
      },
      { find: '@', replacement: path.resolve(__dirname) },
    ],
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..', '..'), __dirname],
    },
  },
});
