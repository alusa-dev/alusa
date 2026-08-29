import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook/react-vite';

const appDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const config: StorybookConfig = {
  stories: ['../**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  staticDirs: ['../public'],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  viteFinal: async (config) => ({
    ...config,
    resolve: {
      ...config.resolve,
      alias: {
        ...config.resolve?.alias,
        '@': appDirectory,
        '@alusa/ui': resolve(appDirectory, '../../packages/ui/src'),
        '@alusa/lib': resolve(appDirectory, '../../packages/lib/src'),
        '@alusa/shared': resolve(appDirectory, '../../packages/shared/src'),
      },
    },
  }),
  docs: {
    autodocs: 'tag',
  },
};

export default config;
