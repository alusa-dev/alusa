import { describe, expect, it } from 'vitest';

import {
  mapFinanceInstallmentAggregatedItemToDTO,
  mapFinanceInstallmentAggregatedResultToDTO,
  mapFinancePayerCandidateToDTO,
  mapFinancePayerSearchResultToDTO,
  mapFinanceSubscriptionEnrichedItemToDTO,
  mapFinanceSubscriptionEnrichedResultToDTO,
} from '@/features/finance/mappers';
import {
  mapPortalDashboardResultToDTO,
  mapPortalFinanceiroDetailToDTO,
  mapPortalFinanceiroListItemToDTO,
} from '@/features/portal/mappers';
import { mapCentroCustoToDTO } from '@/features/financeiro/centros-custo/mappers';
import {
  mapAdminFinancialHealthResultToDTO,
  mapAppHealthResultToDTO,
  mapTestCreateInviteResultToDTO,
} from '@/features/system/mappers';

describe('DTO Refactor Wave 3', () => {
  it('maps finance aggregate contracts', () => {
    const installment = mapFinanceInstallmentAggregatedItemToDTO({
      id: 'plan-1',
      studentName: 'Aluno 1',
      payerName: 'Maria',
      totalValue: 500,
      installmentCount: 5,
      installmentsPaid: 2,
      statusConsolidado: 'EM_DIA',
      proximoVencimento: new Date('2026-03-20T00:00:00Z'),
      matriculaId: 'mat-1',
      contratoId: null,
      createdAt: new Date('2026-03-01T12:00:00Z'),
    });
    const subscription = mapFinanceSubscriptionEnrichedItemToDTO({
      id: 'sub-1',
      asaasSubscriptionId: 'asaas-sub-1',
      clienteNome: 'Maria',
      alunoNome: 'Aluno 1',
      alunoId: 'aluno-1',
      valor: 199.9,
      cycle: 'MONTHLY',
      cycleLabel: 'Mensal',
      billingType: 'BOLETO',
      description: null,
      nextDueDate: new Date('2026-04-01T00:00:00Z'),
      status: 'ACTIVE',
      statusLabel: 'Ativa',
      matriculaId: 'mat-1',
      createdAt: new Date('2026-03-02T12:00:00Z'),
      tipo: 'PLANO',
    });
    const payer = mapFinancePayerCandidateToDTO({
      id: 'aluno-1',
      name: 'Aluno 1',
      type: 'aluno',
      cpf: '12345678901',
      isMinor: false,
      hasResponsible: false,
      responsibleId: null,
      responsibleName: null,
      payerResolved: {
        type: 'aluno',
        id: 'aluno-1',
        name: 'Aluno 1',
        hasAsaasCustomerId: true,
      },
      financialStatus: 'OK',
    });

    const installmentsResult = mapFinanceInstallmentAggregatedResultToDTO({
      data: [installment],
      meta: { total: 1, page: 1, pageSize: 20, totalPages: 1 },
    });
    const subscriptionResult = mapFinanceSubscriptionEnrichedResultToDTO({
      data: [subscription],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
    const payerResult = mapFinancePayerSearchResultToDTO({ results: [payer] });

    expect(installmentsResult.data[0]?.proximoVencimento).toContain('2026-03-20');
    expect(subscriptionResult.data[0]?.nextDueDate).toContain('2026-04-01');
    expect(payerResult.results[0]?.payerResolved.type).toBe('aluno');
  });

  it('maps portal dashboard and financeiro contracts with nullable turma', () => {
    const dashboard = mapPortalDashboardResultToDTO({
      matriculas: { ativas: 2, total: 3 },
      financeiro: {
        pendentes: 1,
        totalPendente: 150,
        proxVencimento: {
          data: '2026-03-15T00:00:00.000Z',
          valor: 150,
        },
      },
      eventos: { proximos: 4 },
    });
    const cobrancaListItem = mapPortalFinanceiroListItemToDTO({
      id: 'cob-1',
      valor: 150,
      vencimento: new Date('2026-03-15T00:00:00Z'),
      status: 'PENDENTE',
      formaPagamento: 'BOLETO',
      asaasId: null,
      invoiceUrl: null,
      matricula: {
        aluno: { nome: 'Aluno 1' },
        turma: null,
        responsavelFinanceiro: null,
      },
      pagamentos: [
        {
          id: 'pag-1',
          dataPagamento: new Date('2026-03-16T00:00:00Z'),
          valorPago: 150,
          status: 'CONFIRMADO',
          formaPagamento: 'BOLETO',
        },
      ],
    });
    const cobrancaDetail = mapPortalFinanceiroDetailToDTO({
      id: 'cob-1',
      tipo: 'MENSALIDADE',
      valor: 150,
      vencimento: new Date('2026-03-15T00:00:00Z'),
      status: 'PENDENTE',
      formaPagamento: 'BOLETO',
      asaasPaymentId: 'pay-1',
      asaasId: 'asaas-1',
      invoiceUrl: null,
      transactionReceiptUrl: null,
      descricao: 'Mensalidade março',
      valorJuros: null,
      valorMulta: null,
      valorDesconto: 10,
      asaasData: {
        invoiceUrl: null,
        transactionReceiptUrl: null,
        status: 'PENDING',
        value: 150,
        dueDate: '2026-03-15',
        billingType: 'BOLETO',
      },
      matricula: {
        aluno: {
          nome: 'Aluno 1',
          cpf: null,
          email: 'aluno@example.com',
          telefone: null,
        },
        turma: null,
        responsavelFinanceiro: null,
      },
      pagamentos: [],
    });

    expect(dashboard.financeiro.proxVencimento?.data).toContain('2026-03-15');
    expect(cobrancaListItem.matricula.turma).toBeNull();
    expect(cobrancaListItem.pagamentos[0]?.dataPagamento).toContain('2026-03-16');
    expect(cobrancaDetail.matricula.turma).toBeNull();
    expect(cobrancaDetail.vencimento).toContain('2026-03-15');
  });

  it('maps centro de custo and health contracts', () => {
    const centro = mapCentroCustoToDTO({
      id: 'cc-1',
      contaId: 'conta-1',
      nome: 'Administrativo',
      tipo: 'DESPESA',
      descricao: null,
      status: 'ATIVO',
      createdAt: new Date('2026-03-01T00:00:00Z'),
      updatedAt: new Date('2026-03-02T00:00:00Z'),
      _count: { lancamentos: 4 },
    });
    const appHealth = mapAppHealthResultToDTO({
      ok: true,
      now: new Date('2026-03-07T12:00:00Z'),
      conta: { id: 'conta-1', nome: 'Alusa' },
    });
    const financialHealth = mapAdminFinancialHealthResultToDTO({
      ok: true,
      overallStatus: 'OK',
      checks: [{ name: 'base_url', ok: true }],
      queue: {
        contaId: 'conta-1',
        backlog: 0,
        pending: 0,
        processing: 0,
        errored: 0,
        processed: 10,
        highRetryBacklog: 0,
        stuckProcessing: 0,
        oldestPendingAt: null,
        lagSeconds: 0,
        generatedAt: new Date('2026-03-07T12:00:00Z'),
      },
      queueStatus: 'OK',
      asaasReads: {
        kycCache: {
          status: { hits: 0, misses: 0, forceRefreshes: 0 },
          documents: { hits: 0, misses: 0, forceRefreshes: 0 },
          invalidations: 0,
        },
        routeReads: {
          cobrancaDetail: { local: 1, remote: 0, freshRemote: 0 },
          portalFinanceiroDetail: { local: 1, remote: 0, freshRemote: 0 },
          matriculaDetail: { local: 1, remote: 0, freshRemote: 0 },
          paymentMethodSync: { local: 1, remote: 0, freshRemote: 0 },
        },
        commandPreflight: {
          statusOnly: 1,
          fullPayment: 0,
        },
        intentStats: {
          READ_MODEL: 1,
          COMMAND_PREFLIGHT_STATUS: 1,
          COMMAND_PREFLIGHT_FULL: 0,
          RECONCILIATION: 0,
          MANUAL_REPAIR: 0,
          AUTHORITATIVE_DOCUMENT: 0,
        },
      },
    });

    expect(centro.createdAt).toContain('2026-03-01');
    expect(appHealth.now).toContain('2026-03-07');
    expect(financialHealth.queue.generatedAt).toContain('2026-03-07');
  });

  it('maps test invite contract', () => {
    const invite = mapTestCreateInviteResultToDTO({
      token: 'invite-token',
      email: 'invite@example.com',
      role: 'RECEPCAO',
    });

    expect(invite.token).toBe('invite-token');
    expect(invite.role).toBe('RECEPCAO');
  });
});
