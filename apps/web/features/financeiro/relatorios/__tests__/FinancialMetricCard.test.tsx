import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FinancialMetricCard } from '../components/FinancialMetricCard';
import { ReportsDataQualityNotice } from '../components/ReportsDataQualityNotice';

describe('FinancialMetricCard', () => {
  it('apresenta valor financeiro com números tabulares e definição acessível', () => {
    render(
      <FinancialMetricCard
        label="Em atraso"
        value={1250.5}
        description="Saldo vencido ainda não recebido."
      />,
    );

    expect(screen.getByText('Em atraso')).toBeInTheDocument();
    expect(screen.getByText('R$ 1.250,50')).toHaveClass('tabular-nums');
    expect(screen.getByLabelText('Como calculamos Em atraso')).toBeInTheDocument();
  });

  it('permite drill-down por teclado e clique quando acionável', () => {
    const onClick = vi.fn();
    render(
      <FinancialMetricCard
        label="Recebido"
        value={500}
        description="Pagamentos confirmados."
        onClick={onClick}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Recebido/i }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('não apresenta zero durante o carregamento', () => {
    render(
      <FinancialMetricCard
        label="Total em cobranças"
        value={0}
        description="Cobranças válidas."
        loading
      />,
    );
    expect(screen.queryByText('R$ 0,00')).not.toBeInTheDocument();
  });
});

describe('ReportsDataQualityNotice', () => {
  it('não ocupa espaço quando não há exclusões', () => {
    const { container } = render(
      <ReportsDataQualityNotice dataQuality={{ excludedRecords: 0, warnings: [] }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('explica registros excluídos sem transformar ausência de data em zero', () => {
    render(
      <ReportsDataQualityNotice
        dataQuality={{
          excludedRecords: 2,
          warnings: ['2 cobranças avulsas não possuem data canônica de recebimento.'],
        }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('data canônica');
  });
});
