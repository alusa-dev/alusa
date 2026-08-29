import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';

import { AlusaLogoLoader } from './AlusaLogoLoader';

const meta = {
  title: 'Feedback/Alusa Logo Loader',
  component: AlusaLogoLoader,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof AlusaLogoLoader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const FullScreen: Story = {
  args: {
    fullScreen: true,
  },
};
