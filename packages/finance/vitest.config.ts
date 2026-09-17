import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/tests/setup.ts'],
    // Os testes de integração executam migrations no mesmo banco de teste.
    // Evita contenção e timeouts não determinísticos quando arquivos rodam em paralelo.
    fileParallelism: false,
  },
});
