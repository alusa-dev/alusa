import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { PricingInteractive } from '@/features/site/components/pricing/PricingInteractive';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: () => ({
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }),
});

afterEach(cleanup);

function expectMonthlyPrice(amount: string) {
  expect(screen.getByText((_, element) => element?.getAttribute('aria-live') === 'polite')).toHaveTextContent(
    amount,
  );
  expect(document.querySelector('.pricing-result .sliding-number')).toHaveAttribute(
    'data-value',
    amount.split(',')[0],
  );
}

describe('PricingInteractive', () => {
  it('updates the monthly price and selected table row from the numeric input', () => {
    render(<PricingInteractive />);
    const input = screen.getByLabelText('Quantos alunos ativos pagantes sua escola tem?');
    expectMonthlyPrice('419,00');
    expect(input).toHaveValue(165);
    expect(screen.getByRole('link', { name: 'Entrar na lista de espera' })).toHaveAttribute(
      'href',
      '/lista-de-espera',
    );
    input.focus();
    fireEvent.change(input, { target: { value: '' } });
    expect((input as HTMLInputElement).value).toBe('');
    fireEvent.change(input, { target: { value: '25' } });

    expect(input).toHaveValue(25);
    expectMonthlyPrice('169,00');
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole('row', { name: /Até 25 alunos/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('keeps 500 students self-service and directs 501+ to a specialist', () => {
    render(<PricingInteractive />);
    const range = screen.getByRole('slider', { name: 'Quantidade de alunos, de 1 a 500' });

    fireEvent.change(range, { target: { value: '499' } });
    expect(screen.getByRole('link', { name: 'Entrar na lista de espera' })).toHaveAttribute('href', '/lista-de-espera');

    fireEvent.change(range, { target: { value: '500' } });
    expectMonthlyPrice('649,00');
    expect(screen.getByRole('row', { name: /401 a 500 alunos/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('link', { name: 'Entrar na lista de espera' })).toHaveAttribute('href', '/lista-de-espera');

    fireEvent.change(screen.getByLabelText('Quantos alunos ativos pagantes sua escola tem?'), { target: { value: '501' } });
    expect(screen.getAllByText('Condição personalizada')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Conversar com um especialista' })).toHaveAttribute(
      'href',
      'mailto:contato@alusa.app?subject=Plano%20para%20escola%20com%20mais%20de%20500%20alunos',
    );

    fireEvent.change(range, { target: { value: '499' } });
    expect(screen.getByRole('link', { name: 'Entrar na lista de espera' })).toHaveAttribute(
      'href',
      '/lista-de-espera',
    );
  });

  it('selects the boundary tiers at 1 and 26 students', () => {
    render(<PricingInteractive />);
    const input = screen.getByLabelText('Quantos alunos ativos pagantes sua escola tem?');

    for (const [students, expectedPrice] of [
      ['1', '169,00'],
      ['26', '229,00'],
    ]) {
      fireEvent.change(input, { target: { value: students } });
      expectMonthlyPrice(expectedPrice);
    }
  });
});
