import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { FinancialOverviewReport } from '../dtos';
import { ExecutiveFinancialOverview } from '../components/ExecutiveFinancialOverview';

function buildReport(
  summary: Partial<FinancialOverviewReport['summary']> = {},
): FinancialOverviewReport {
  return {
    view: 'overview',
    generatedAt: '2026-07-30T20:00:00.000Z',
    timeZone: 'America/Sao_Paulo',
    dateBasis: 'DUE_DATE',
    summary: {
      totalCharges: 1000,
      received: 800,
      receivable: 150,
      overdue: 50,
      processing: 0,
      fees: 10,
      refunds: 0,
      net: 790,
      toSettle: 0,
      available: 790,
      averageTicket: 200,
      delinquencyRate: 5,
      chargeCount: 5,
      receivedCount: 4,
      overdueCount: 1,
      ...summary,
    },
    series: [],
    enrollmentSeries: [],
    enrollmentHealth: {
      activeEnrollments: 0,
      enrollmentsInPeriod: 0,
      cancellationsInPeriod: 0,
      openingActiveEnrollments: 0,
      retentionRate: null,
    },
    statusBreakdown: [],
    typeBreakdown: [],
    paymentMethodBreakdown: [],
    rankingByClass: [],
    rankingByPlan: [],
    cancellationsByClass: [],
    classOccupancy: [],
    details: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 },
    dataQuality: { excludedRecords: 0, warnings: [] },
  };
}

describe('ExecutiveFinancialOverview', () => {
  afterEach(() => cleanup());

  it('apresenta diagnóstico saudável quando a inadimplência está controlada', () => {
    render(
      React.createElement(ExecutiveFinancialOverview, { data: buildReport(), loading: false }),
    );

    expect(screen.getByText('Negócio saudável')).toBeInTheDocument();
    expect(screen.getByLabelText('Score de saúde do negócio: 95 de 100')).toBeInTheDocument();
    expect(screen.queryByText('Pagamentos 94,7%')).not.toBeInTheDocument();
    expect(screen.queryByText('Ocupação —')).not.toBeInTheDocument();
    expect(screen.queryByText('Permanência —')).not.toBeInTheDocument();
    const overview = screen.getByRole('region', { name: 'Visão geral' });
    expect(
      within(overview).getByRole('heading', { name: 'Score de saúde do negócio' }),
    ).toBeInTheDocument();
    expect(
      within(overview).getByRole('heading', { name: 'Ocupação das turmas' }),
    ).toBeInTheDocument();
    expect(
      within(overview).getByRole('heading', { name: 'Matrículas × Cancelamentos' }),
    ).toBeInTheDocument();
  });

  it('sinaliza situação crítica sem chamar valor líquido de lucro', () => {
    render(
      React.createElement(ExecutiveFinancialOverview, {
        data: buildReport({ overdue: 250, receivable: 0, delinquencyRate: 25 }),
        loading: false,
      }),
    );

    expect(screen.getByText('Saúde crítica')).toBeInTheDocument();
    expect(screen.getByLabelText('Score de saúde do negócio: 39 de 100')).toBeInTheDocument();
    expect(
      screen.getByText(/o valor líquido exibido não deve ser interpretado como lucro/i),
    ).toBeInTheDocument();
  });

  it('mantém o score independente dos dados filtrados do relatório', () => {
    const filteredReport = buildReport({
      received: 100,
      overdue: 900,
      net: 99,
      delinquencyRate: 90,
    });
    const currentBusinessHealth = buildReport();

    render(
      React.createElement(ExecutiveFinancialOverview, {
        data: filteredReport,
        loading: false,
        businessHealthData: currentBusinessHealth,
        businessHealthLoading: false,
      }),
    );

    expect(screen.getByText('Negócio saudável')).toBeInTheDocument();
    expect(screen.getByLabelText('Score de saúde do negócio: 95 de 100')).toBeInTheDocument();
    expect(screen.getByText('Estado operacional atual da escola.')).toBeInTheDocument();
  });

  it('mantém matrículas e cancelamentos no recorte anual independente do relatório', () => {
    const annualReport = buildReport();
    annualReport.enrollmentSeries = [
      { key: '2026-01', label: 'jan. de 26', enrollments: 4, cancellations: 1 },
      { key: '2026-02', label: 'fev. de 26', enrollments: 6, cancellations: 0 },
    ];
    annualReport.series = [
      {
        key: '2026-01',
        label: 'jan. de 26',
        charged: 600,
        received: 450,
        overdue: 150,
        net: 440,
      },
    ];

    render(
      React.createElement(ExecutiveFinancialOverview, {
        data: buildReport(),
        loading: false,
        annualEnrollmentData: annualReport,
        annualEnrollmentLoading: false,
      }),
    );

    expect(
      screen.getByText('Evolução mensal de matrículas e cancelamentos no ano atual.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Evolução mensal do total cobrado e recebido no ano atual.'),
    ).toBeInTheDocument();
    const financialTable = screen.getByRole('table', {
      name: 'Total em cobranças e recebido por mês',
    });
    expect(financialTable).toHaveTextContent('R$ 600,00');
    expect(financialTable).toHaveTextContent('R$ 450,00');
    expect(
      screen.queryByText('Sem movimentações de matrícula no ano atual.'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('table', { name: 'Matrículas e cancelamentos por mês' }),
    ).toBeInTheDocument();
  });

  it('não exibe valores zerados enquanto os dados estão carregando', () => {
    render(React.createElement(ExecutiveFinancialOverview, { data: null, loading: true }));

    expect(screen.queryByText('R$ 0,00')).not.toBeInTheDocument();
  });

  it('apresenta a composição dos recebimentos sem percentuais visuais redundantes', () => {
    render(
      React.createElement(ExecutiveFinancialOverview, { data: buildReport(), loading: false }),
    );

    const composition = screen.getByRole('region', { name: 'Situação dos recebimentos' });
    expect(within(composition).getAllByText('R$ 800,00')).toHaveLength(2);
    expect(within(composition).getByText('R$ 150,00')).toBeInTheDocument();
    expect(within(composition).getByText('R$ 50,00')).toBeInTheDocument();
    expect(within(composition).queryByText('80%')).not.toBeInTheDocument();
    expect(within(composition).queryByText('15%')).not.toBeInTheDocument();
    expect(within(composition).queryByText('5%')).not.toBeInTheDocument();
  });

  it('exibe ocupação real por turma e média ponderada das vagas', () => {
    const report = buildReport();
    report.classOccupancy = [
      { id: 't-a', name: 'Ballet Infantil', capacity: 10, occupiedSeats: 8, occupancyRate: 80 },
      { id: 't-b', name: 'Jazz Intermediário', capacity: 30, occupiedSeats: 15, occupancyRate: 50 },
    ];

    render(React.createElement(ExecutiveFinancialOverview, { data: report, loading: false }));

    expect(screen.getByRole('heading', { name: 'Ocupação das turmas' })).toBeInTheDocument();
    expect(screen.getByText('Ballet Infantil')).toBeInTheDocument();
    expect(screen.getByText('8/10')).toBeInTheDocument();
    expect(screen.getByText('15/30')).toBeInTheDocument();
    expect(
      screen.getByLabelText('A ocupação está em 57,5% das vagas disponíveis'),
    ).toHaveTextContent('A ocupação está em 57,5% das vagas disponíveis.');
  });
});
