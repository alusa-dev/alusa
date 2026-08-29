import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';

import { Button } from './button';

const meta = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  args: {
    children: 'Continuar',
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <Button {...args} variant="default">Principal</Button>
      <Button {...args} variant="secondary">Secundário</Button>
      <Button {...args} variant="outline">Contorno</Button>
      <Button {...args} variant="ghost">Discreto</Button>
      <Button {...args} variant="destructive">Excluir</Button>
    </div>
  ),
};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};
