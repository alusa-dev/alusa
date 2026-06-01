// Necessário para JSX no ambiente de teste atual
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React from 'react';
void React;

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LegalPage } from '@/features/site/components/legal/LegalPage';
import { legalPages } from '@/features/site/content/legal';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}));

describe('LegalPage', () => {
  it('renderiza a lateral nas páginas abertas com o item ativo destacado', () => {
    render(<LegalPage content={legalPages.privacidade} />);

    expect(screen.getByRole('navigation', { name: 'Páginas legais' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Política de Privacidade' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('link', { name: 'Termos de Uso' })).toHaveAttribute('href', '/termos');
  });
});