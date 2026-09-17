import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // O workspace pode conter artefatos JS gerados dentro de src por sessões
    // antigas. Testes sempre devem resolver a fonte TypeScript canônica.
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs'],
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
