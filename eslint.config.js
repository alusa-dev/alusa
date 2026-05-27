// ESM flat config simplified
import js from '@eslint/js';
import * as tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  // Usando apenas recommended (sem exigir type info globalmente)
  ...tseslint.configs.recommended,
  reactPlugin.configs.flat.recommended,
  reactPlugin.configs.flat['jsx-runtime'],
  prettier,
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/coverage/**', '**/next-env.d.ts', '**/*.ts.disabled'] },
  {
    files: ['**/tailwind.config.js','**/postcss.config.cjs','**/*.config.{js,cjs,mjs}', '**/scripts/**/*.{js,mjs,ts}'],
    languageOptions: { globals: { module: true, require: true, process: true, console: true, fetch: true, setTimeout: true } },
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  },
  {
    files: ['packages/asaas/src/**/*.js'],
    languageOptions: {
      globals: {
        Blob: true,
        FormData: true,
        URL: true,
        console: true,
        fetch: true,
        process: true,
        setTimeout: true,
      },
    },
  },
  {
    files: ['packages/database/src/**/*.js'],
    languageOptions: {
      globals: {
        Buffer: true,
        process: true,
      },
    },
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
      'react/no-unknown-property': ['error', { ignore: ['jsx', 'global'] }],
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
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@alusa/asaas',
              message: 'Use @alusa/finance como fachada de integração Asaas.',
            },
            {
              name: '@alusa/asaas-gateway',
              message: 'Contratos Asaas devem vir de @alusa/finance.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/lib/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@alusa/asaas',
              message: 'Orquestração Asaas pertence a @alusa/finance.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/lib/src/alunos/sync-aluno-asaas.ts.disabled'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['packages/asaas-gateway/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@alusa/database',
              message: 'Gateway não acessa banco.',
            },
            {
              name: '@alusa/finance',
              message: 'Gateway não depende da camada de negócio.',
            },
            {
              name: '@prisma/client',
              message: 'Gateway não acessa Prisma.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/asaas/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@alusa/database',
              message: 'Cliente HTTP puro — sem persistência.',
            },
            {
              name: '@alusa/finance',
              message: 'Cliente HTTP puro — sem dependência invertida.',
            },
            {
              name: '@prisma/client',
              message: 'Cliente HTTP puro — sem Prisma.',
            },
          ],
        },
      ],
    },
  },
  // Override sem type-aware para libs internas adicionadas recentemente (evita erro de project include)
  {
    files: ['apps/web/lib/**/*.{ts,tsx}'],
    languageOptions: { parserOptions: { project: null } }
  },
  {
    files: ['apps/web/features/events/map/canvas/**/*.{ts,tsx}'],
    ignores: ['apps/web/features/events/map/canvas/__tests__/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[object.name="Math"][property.name=/^(sin|cos|tan|asin|acos|atan|atan2)$/]',
          message:
            'Trigonometria pertence ao map-engine (@alusa/domain). Use worldToParentLocal, toLocal/toGlobal ou adapters.',
        },
      ],
    },
  },
];
