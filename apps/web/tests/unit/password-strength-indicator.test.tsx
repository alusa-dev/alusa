import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import PasswordStrengthIndicator from '@/components/auth/PasswordStrengthIndicator';

afterEach(cleanup);

describe('PasswordStrengthIndicator', () => {
  it('permanece oculto até que a senha tenha caracteres', () => {
    const { container } = render(
      <>
        <PasswordStrengthIndicator password="" placement="field" />
        <PasswordStrengthIndicator password="" placement="meter" />
      </>,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('exibe o nível junto ao campo e uma barra contínua abaixo', () => {
    render(
      <>
        <PasswordStrengthIndicator password="A" placement="field" />
        <PasswordStrengthIndicator password="A" placement="meter" />
      </>,
    );

    expect(screen.getByTestId('register-password-strength-label')).toHaveTextContent('Muito fraca');
    const progressbar = screen.getByRole('progressbar', { name: 'Avaliação de segurança da senha' });
    expect(progressbar).toHaveAttribute('aria-valuenow', '1');
    expect(progressbar.children).toHaveLength(1);
    expect(progressbar.firstElementChild).toHaveStyle({ width: '20%' });
  });
});
