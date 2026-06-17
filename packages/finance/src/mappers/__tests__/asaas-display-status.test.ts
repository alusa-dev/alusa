import { describe, expect, it } from 'vitest';

import {
  ASAAS_PAYMENT_STATUS_VALUES,
  resolveChargeDisplayStatus,
} from '../asaas-display-status';

describe('resolveChargeDisplayStatus', () => {
  it('covers every official Asaas payment status used by Alusa display', () => {
    for (const status of ASAAS_PAYMENT_STATUS_VALUES) {
      const result = resolveChargeDisplayStatus({ asaasStatus: status, localStatus: 'PAGO' });
      expect(result.source).toBe('asaas');
      expect(result.status).toBe(status);
      expect(result.label.length).toBeGreaterThan(0);
    }
  });

  it('distinguishes confirmed from received according to Asaas lifecycle', () => {
    expect(resolveChargeDisplayStatus({ asaasStatus: 'CONFIRMED' })).toMatchObject({
      label: 'Confirmada',
      hint: 'Pagamento efetuado; saldo ainda não disponibilizado na conta Asaas.',
      variant: 'success',
    });

    expect(resolveChargeDisplayStatus({ asaasStatus: 'RECEIVED' })).toMatchObject({
      label: 'Recebida',
      hint: 'Valor disponível na conta Asaas.',
      variant: 'success',
    });
  });

  it('uses liquidation as a fallback for paid Asaas-linked charges without remote status', () => {
    expect(
      resolveChargeDisplayStatus({
        localStatus: 'PAGO',
        liquidacaoStatus: 'PENDENTE',
        hasAsaasLink: true,
      }),
    ).toMatchObject({ status: 'CONFIRMED', label: 'Confirmada', source: 'liquidacao' });

    expect(
      resolveChargeDisplayStatus({
        localStatus: 'PAGO',
        liquidacaoStatus: 'DISPONIVEL',
        hasAsaasLink: true,
      }),
    ).toMatchObject({ status: 'RECEIVED', label: 'Recebida', source: 'liquidacao' });
  });

  it('keeps local manual payments as Pago when there is no Asaas context', () => {
    expect(resolveChargeDisplayStatus({ localStatus: 'PAGO' })).toMatchObject({
      status: 'PAGO',
      label: 'Pago',
      source: 'local',
    });
  });

  it('maps risk, dunning, refund and chargeback statuses to explicit labels', () => {
    expect(resolveChargeDisplayStatus({ asaasStatus: 'AWAITING_RISK_ANALYSIS' }).label).toBe('Em análise');
    expect(resolveChargeDisplayStatus({ asaasStatus: 'DUNNING_REQUESTED' }).label).toBe('Negativação solicitada');
    expect(resolveChargeDisplayStatus({ asaasStatus: 'DUNNING_RECEIVED' }).label).toBe('Recebida por negativação');
    expect(resolveChargeDisplayStatus({ asaasStatus: 'REFUND_IN_PROGRESS' }).label).toBe('Estorno em processamento');
    expect(resolveChargeDisplayStatus({ asaasStatus: 'CHARGEBACK_DISPUTE' }).label).toBe('Chargeback em disputa');
  });

  it('maps DELETED to Removida', () => {
    expect(resolveChargeDisplayStatus({ asaasStatus: 'DELETED' })).toMatchObject({
      status: 'DELETED',
      label: 'Removida',
      source: 'asaas',
      variant: 'neutral',
    });
  });

  it('maps event and domain statuses to Portuguese labels', () => {
    expect(resolveChargeDisplayStatus({ localStatus: 'PAYMENT_PENDING' })).toMatchObject({
      label: 'Pendente',
      variant: 'warning',
    });
    expect(resolveChargeDisplayStatus({ localStatus: 'EXPECTED' })).toMatchObject({
      label: 'Previsto',
      variant: 'info',
    });
    expect(resolveChargeDisplayStatus({ localStatus: 'COMPLIMENTARY' })).toMatchObject({
      label: 'Cortesia',
      variant: 'success',
    });
  });

  it('never exposes raw English tokens for unknown statuses', () => {
    expect(resolveChargeDisplayStatus({ localStatus: 'SOME_NEW_STATUS' }).label).toBe('Desconhecido');
  });
});
