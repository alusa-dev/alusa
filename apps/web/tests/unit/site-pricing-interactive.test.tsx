import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PricingInteractive } from '@/features/site/components/pricing/PricingInteractive';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: () => ({
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }),
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

function expectMonthlyPrice(amount: string) {
  expect(screen.getByText((_, element) => element?.getAttribute('aria-live') === 'polite')).toHaveTextContent(
    amount,
  );
  expect(document.querySelector('.pricing-result .sliding-number')).toHaveAttribute(
    'data-value',
    amount.split(',')[0],
  );
}

function expectPricingLinks(name: string, href: string) {
  const links = screen.getAllByRole('link', { name });
  expect(links.length).toBeGreaterThan(0);
  links.forEach((link) => expect(link).toHaveAttribute('href', href));
}

describe('PricingInteractive', () => {
  it('updates the monthly price and selected table row from the numeric input', () => {
    render(<PricingInteractive />);
    const input = screen.getByLabelText('Quantos alunos ativos pagantes sua escola tem?');
    expectMonthlyPrice('419,00');
    expect(input).toHaveValue(165);
    expectPricingLinks('Teste grátis por 14 dias', '/auth/register?studentCount=165');
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

  it('offers direct signup through 500 students and specialist contact above 500', () => {
    window.history.replaceState({}, '', '/precos');
    render(<PricingInteractive />);
    const range = screen.getByRole('slider', { name: 'Quantidade de alunos' });

    fireEvent.change(range, { target: { value: '499' } });
    expectPricingLinks('Teste grátis por 14 dias', '/auth/register?studentCount=499');

    fireEvent.change(range, { target: { value: '500' } });
    expectMonthlyPrice('649,00');
    expectPricingLinks('Teste grátis por 14 dias', '/auth/register?studentCount=500');
    expect(new URL(window.location.href).searchParams.get('studentCount')).toBe('500');
    expect(screen.getByRole('row', { name: /401 a 500 alunos/ })).toHaveAttribute(
      'aria-current',
      'true',
    );

    expect(screen.getByText('Mais de 500 alunos', { selector: '.pricing-range-labels span' })).toBeInTheDocument();
    fireEvent.change(range, { target: { value: '501' } });
    expect(range).toHaveValue('501');
    expect(range).toHaveAttribute('aria-valuetext', 'Mais de 500 alunos');
    expectPricingLinks('Fale com a Alusa', '/get-started?studentCount=501');
    expect(new URL(window.location.href).searchParams.get('studentCount')).toBe('501');
    expect(screen.getByRole('row', { name: /Mais de 500 alunos/ })).toHaveAttribute(
      'aria-current',
      'true',
    );

    fireEvent.change(screen.getByLabelText('Quantos alunos ativos pagantes sua escola tem?'), { target: { value: '501' } });
    expect(screen.getAllByText('Condição personalizada')).toHaveLength(2);
    expectPricingLinks('Fale com a Alusa', '/get-started?studentCount=501');

    fireEvent.change(range, { target: { value: '499' } });
    expectPricingLinks('Teste grátis por 14 dias', '/auth/register?studentCount=499');
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
