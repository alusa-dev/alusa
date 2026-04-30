import { defineConfig } from 'vitest/config';

/**
 * Configuração leve para testes unitários que não dependem de banco de dados.
 * Use: pnpm vitest run --config vitest.unit.config.ts
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/tests/setup-unit.ts'],
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
