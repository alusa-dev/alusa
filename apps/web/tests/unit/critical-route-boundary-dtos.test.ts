import { describe, expect, it } from 'vitest';

import { matriculaBillingGroupsQueryDTOSchema } from '@/features/cadastro/matriculas/dtos';
import {
  financeInstallmentRouteParamsDTOSchema,
  financeSubscriptionRouteParamsDTOSchema,
} from '@/features/finance/dtos';
import {
  notaFiscalAlunoRouteParamsDTOSchema,
  notaFiscalPersonDetailQueryDTOSchema,
} from '@/features/financeiro/notafiscal/dtos';
import {
  adminAsaasApiKeyInputDTOSchema,
  adminFinancialOperationalHealthResultDTOSchema,
  adminWebhookDlqInputDTOSchema,
  adminWebhookReprocessInputDTOSchema,
} from '@/features/system/dtos';
import { mapAdminFinancialOperationalHealthResultToDTO } from '@/features/system/mappers';
import {
  platformBillingWebhookListQueryDTOSchema,
  platformBillingWebhookReplayInputDTOSchema,
} from '@/features/platform-billing/dtos';
import {
  publicEventContractRouteParamsDTOSchema,
  publicEventMapCheckoutRouteParamsDTOSchema,
} from '@/features/public/dtos';
import { storageFileRouteParamsDTOSchema } from '@/features/storage/dtos';

describe('boundaries de entrada das rotas críticas', () => {
  it('normaliza filtros e limites de operações administrativas', () => {
    expect(adminAsaasApiKeyInputDTOSchema.safeParse({ apiKey: 'short' }).success).toBe(false);
    expect(adminWebhookDlqInputDTOSchema.parse({ ids: [' webhook-1 '] })).toEqual({ ids: ['webhook-1'] });
    expect(adminWebhookReprocessInputDTOSchema.parse({ reason: 'reprocessar após falha' })).toEqual({
      reason: 'reprocessar após falha',
    });
    expect(
      platformBillingWebhookListQueryDTOSchema.parse({
        status: ['failed', 'invalid'],
        limit: '999',
      }),
    ).toEqual({ status: ['FAILED'], limit: 100 });
    expect(
      platformBillingWebhookReplayInputDTOSchema.parse({
        ids: [' event-1 '],
        reason: 'retry after provider outage',
      }),
    ).toEqual({ ids: ['event-1'], reason: 'retry after provider outage' });
  });

  it('valida parâmetros de recursos sem selecionar tenant', () => {
    expect(financeInstallmentRouteParamsDTOSchema.parse({ id: ' installment-1 ' })).toEqual({
      id: 'installment-1',
    });
    expect(financeSubscriptionRouteParamsDTOSchema.parse({ id: 'subscription-1' })).toEqual({
      id: 'subscription-1',
    });
    expect(storageFileRouteParamsDTOSchema.parse({ key: ['uploads', 'conta-a', 'file.pdf'] })).toEqual({
      key: ['uploads', 'conta-a', 'file.pdf'],
    });
  });

  it('mantém filtros fiscais tolerantes e parâmetros públicos delimitados', () => {
    expect(
      notaFiscalPersonDetailQueryDTOSchema.parse({
        status: ['authorized', 'unknown'],
        effectiveDateFrom: ' 2026-01-01 ',
      }),
    ).toEqual({
      status: ['AUTHORIZED'],
      effectiveDateFrom: '2026-01-01',
      effectiveDateTo: undefined,
    });
    expect(notaFiscalAlunoRouteParamsDTOSchema.parse({ alunoId: ' aluno-1 ' })).toEqual({
      alunoId: 'aluno-1',
    });
    expect(publicEventContractRouteParamsDTOSchema.parse({ token: ' token-1 ' })).toEqual({
      token: 'token-1',
    });
    expect(publicEventMapCheckoutRouteParamsDTOSchema.parse({ publicSlug: ' show-2026 ' })).toEqual({
      publicSlug: 'show-2026',
    });
  });

  it('preserva compatibilidade de cobrança familiar e rejeita dados sem pagador', () => {
    expect(
      matriculaBillingGroupsQueryDTOSchema.parse({
        responsavelId: 'resp-1',
        formaPagamento: 'CARTAO',
        vencimentoDia: '15',
      }),
    ).toMatchObject({
      responsavelId: 'resp-1',
      formaPagamento: 'CARTAO_CREDITO',
      vencimentoDia: 15,
    });
  });

  it('serializa a saúde operacional financeira sem expor datas Prisma', () => {
    const dto = mapAdminFinancialOperationalHealthResultToDTO({
      success: true,
      result: {
        generatedAt: new Date('2026-09-15T12:00:00.000Z'),
        accounts: [
          {
            contaId: 'conta-a',
            metrics: [{ key: 'webhook_backlog', value: 2, threshold: 50, severity: 'INFO' }],
            openedAlerts: 0,
            resolvedAlerts: 1,
          },
        ],
      },
      alerts: [
        {
          id: 'alert-1',
          contaId: 'conta-a',
          alertKey: 'webhook_stale',
          severity: 'WARNING',
          status: 'OPEN',
          title: 'Webhook parado',
          description: null,
          metricValue: 1,
          threshold: 1,
          metadata: null,
          firstSeenAt: new Date('2026-09-15T11:00:00.000Z'),
          lastSeenAt: new Date('2026-09-15T12:00:00.000Z'),
          resolvedAt: null,
          createdAt: new Date('2026-09-15T11:00:00.000Z'),
          updatedAt: new Date('2026-09-15T12:00:00.000Z'),
        },
      ],
    });

    expect(adminFinancialOperationalHealthResultDTOSchema.parse(dto)).toEqual(dto);
    expect(dto.result.generatedAt).toBe('2026-09-15T12:00:00.000Z');
    expect(dto.alerts[0]?.firstSeenAt).toBe('2026-09-15T11:00:00.000Z');
  });
});
