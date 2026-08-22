import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AlusaLogoLoader } from '@/components/feedback/AlusaLogoLoader';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AlusaLogoLoader', () => {
  it('renders an accessible full-screen loading state using the Alusa logo', () => {
    render(React.createElement(AlusaLogoLoader, { fullScreen: true }));

    const loader = screen.getByRole('status', { name: 'Carregando' });
    const logo = screen.getByTestId('alusa-loader-logo');

    expect(loader).toHaveClass('fixed', 'inset-0', 'min-h-dvh');
    expect(logo).toHaveClass('bg-[#dfe4e9]', 'animate-pulse', 'motion-reduce:animate-none');
    expect(logo).toHaveClass("[mask-image:url('/brand/logo-sidebar-mask.svg')]");
  });

  it('can be reused inside a bounded container', () => {
    render(React.createElement(AlusaLogoLoader));

    const loader = screen.getByRole('status', { name: 'Carregando' });

    expect(loader).toHaveClass('min-h-40', 'w-full');
    expect(loader).not.toHaveClass('fixed');
  });
});
