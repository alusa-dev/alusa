// ESM flat config simplified
import js from '@eslint/js';
import * as tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import tenantSafety from './eslint-plugin-tenant-safety.mjs';

export default [
  js.configs.recommended,
  // Usando apenas recommended (sem exigir type info globalmente)
  ...tseslint.configs.recommended,
  reactPlugin.configs.flat.recommended,
  reactPlugin.configs.flat['jsx-runtime'],
  prettier,
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/coverage/**'] },
  {
    files: ['**/tailwind.config.js','**/postcss.config.cjs','**/*.config.{js,cjs,mjs}', '**/scripts/**/*.{js,mjs,ts}'],
    languageOptions: { globals: { module: true, require: true, process: true, console: true, fetch: true, setTimeout: true } }
  },
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // por quê: reduzir fricção inicial em prototipagem de componentes reutilizáveis
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      'react/prop-types': 'off',
      'react/no-unknown-property': ['error', { ignore: ['jsx'] }],
      'no-restricted-imports': [
        'warn',
        {
          paths: [
            {
              name: '@heroicons/react/24/outline',
              message: 'Importe ícones via \'@/components/icons/icons\' para padronizar.'
            },
            {
              name: '@heroicons/react/24/solid',
              message: 'Use o alias central e documente o uso de versão solid.'
            },
            {
              name: 'lucide-react',
              message: 'Biblioteca descontinuada neste projeto. Use ícones de @/components/icons.'
            }
          ],
          patterns: [
            {
              group: ['@alusa/finance/dtos/*', '@alusa/domain/dtos/*'],
              message: 'Importe DTOs pelos barrels públicos de @alusa/finance ou @alusa/domain.'
            }
          ]
        }
      ]
    },
    settings: { react: { version: 'detect' } }
  },
  {
    files: ['apps/web/components/icons/icons.tsx'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  // Override sem type-aware para libs internas adicionadas recentemente (evita erro de project include)
  {
    files: ['apps/web/lib/**/*.{ts,tsx}'],
    languageOptions: { parserOptions: { project: null } }
  },
  // ─── Regras de Segurança Multitenant ────────────────────────────────────────
  // Aplica verificações de isolamento de tenant em route handlers e server actions.
  // A regra 'no-unscoped-prisma-query' avisa quando uma query Prisma num modelo
  // tenant-aware não contém 'contaId' no where, prevenindo vazamento cross-tenant.
  {
    files: ['apps/web/app/api/**/*.{ts,tsx}', 'apps/web/app/(app)/**/*.{ts,tsx}', 'apps/web/features/**/*.{ts,tsx}'],
    plugins: { 'tenant-safety': tenantSafety },
    rules: {
      'tenant-safety/no-unscoped-prisma-query': 'warn',
      // Descomente para exigir o uso do cliente tenant em route handlers:
      // 'tenant-safety/prefer-tenant-client': 'warn',
    },
  }
  // (Opcional futuramente) adicionar override tipado para src somente
];
