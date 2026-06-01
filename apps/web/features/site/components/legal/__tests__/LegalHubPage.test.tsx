// Necessário para JSX no ambiente de teste atual
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React from 'react';
void React;

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LegalHubPage } from '@/features/site/components/legal/LegalHubPage';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}));

describe('LegalHubPage', () => {
  it('renderiza o hub legal com os principais documentos publicados', () => {
    render(<LegalHubPage />);

    expect(screen.getByRole('heading', { name: 'Legal', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Política de Privacidade' })).toHaveAttribute('href', '/privacidade');
    expect(screen.getByRole('link', { name: 'Termos de Uso' })).toHaveAttribute('href', '/termos');
    expect(screen.getByRole('link', { name: 'Direitos LGPD' })).toHaveAttribute('href', '/direitos-lgpd');
  });

  it('mantém a lista simples sem CTA secundário de cards', () => {
    render(<LegalHubPage />);

    expect(screen.queryByText('Rota pública disponível')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Abrir /i })).not.toBeInTheDocument();
  });
});