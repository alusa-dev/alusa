import { describe, expect, it } from 'vitest';

import {
  buildPaymentStateTransitionDedupeKey,
  decideChargePaymentTransition,
  decideCobrancaPaymentTransition,
} from '../payment-state-machine';

describe('payment-state-machine', () => {
  it('aplica confirmação em cobrança aberta', () => {
    const result = decideCobrancaPaymentTransition({
      currentLocalStatus: 'A_VENCER',
      currentProviderStatus: 'PENDING',
      incomingProviderStatus: 'CONFIRMED',
      eventName: 'PAYMENT_CONFIRMED',
      source: 'WEBHOOK',
    });

    expect(result).toMatchObject({
      kind: 'APPLY',
      previousLocalStatus: 'A_VENCER',
      nextLocalStatus: 'PAGO',
      nextProviderStatus: 'CONFIRMED',
    });
  });

  it('não permite PAYMENT_OVERDUE antigo regredir cobrança paga', () => {
    const result = decideCobrancaPaymentTransition({
      currentLocalStatus: 'PAGO',
      currentProviderStatus: 'CONFIRMED',
      incomingProviderStatus: 'OVERDUE',
      eventName: 'PAYMENT_OVERDUE',
      source: 'WEBHOOK',
    });

    expect(result.kind).toBe('NOOP');
    expect(result.nextLocalStatus).toBe('PAGO');
    expect(result.reason).toBe('REGRESSION_BLOCKED');
  });

  it('permite somente a reversão explícita de recebimento em dinheiro', () => {
    const result = decideCobrancaPaymentTransition({
      currentLocalStatus: 'PAGO',
      currentProviderStatus: 'RECEIVED_IN_CASH',
      incomingProviderStatus: 'OVERDUE',
      eventName: 'PAYMENT_RECEIVED_IN_CASH_UNDONE',
      source: 'WEBHOOK',
    });

    expect(result).toMatchObject({ kind: 'APPLY', nextLocalStatus: 'ATRASADO' });
  });

  it('mantém estorno/chargeback possíveis sem permitir restauração indevida', () => {
    const refund = decideCobrancaPaymentTransition({
      currentLocalStatus: 'PAGO',
      currentProviderStatus: 'RECEIVED',
      incomingProviderStatus: 'REFUNDED',
      eventName: 'PAYMENT_REFUNDED',
      source: 'WEBHOOK',
    });
    const oldConfirmation = decideCobrancaPaymentTransition({
      currentLocalStatus: 'ESTORNADO',
      currentProviderStatus: 'REFUNDED',
      incomingProviderStatus: 'CONFIRMED',
      eventName: 'PAYMENT_CONFIRMED',
      source: 'WEBHOOK',
    });

    expect(refund).toMatchObject({ kind: 'APPLY', nextLocalStatus: 'ESTORNADO' });
    expect(oldConfirmation).toMatchObject({ kind: 'NOOP', nextLocalStatus: 'ESTORNADO' });
  });

  it('permite a reversão oficial de chargeback quando o provider volta a confirmar', () => {
    const result = decideCobrancaPaymentTransition({
      currentLocalStatus: 'ESTORNADO',
      currentProviderStatus: 'AWAITING_CHARGEBACK_REVERSAL',
      incomingProviderStatus: 'CONFIRMED',
      eventName: 'PAYMENT_CONFIRMED',
      source: 'WEBHOOK',
    });

    expect(result).toMatchObject({
      kind: 'APPLY',
      nextLocalStatus: 'PAGO',
      reason: 'ASAAS_STATUS_APPLIED',
    });
  });

  it('permite restauração apenas de CANCELADO, nunca de estornado', () => {
    const restored = decideCobrancaPaymentTransition({
      currentLocalStatus: 'CANCELADO',
      currentProviderStatus: 'DELETED',
      incomingProviderStatus: 'PENDING',
      eventName: 'PAYMENT_RESTORED',
      dueDate: new Date('2099-01-01'),
      now: new Date('2098-01-01'),
      source: 'WEBHOOK',
    });
    const blocked = decideCobrancaPaymentTransition({
      currentLocalStatus: 'ESTORNADO',
      currentProviderStatus: 'REFUNDED',
      incomingProviderStatus: 'PENDING',
      eventName: 'PAYMENT_RESTORED',
      source: 'WEBHOOK',
    });

    expect(restored).toMatchObject({ kind: 'APPLY', nextLocalStatus: 'A_VENCER' });
    expect(blocked).toMatchObject({ kind: 'NOOP', nextLocalStatus: 'ESTORNADO' });
  });

  it('aplica a mesma regra ao Charge avulso', () => {
    const result = decideChargePaymentTransition({
      currentLocalStatus: 'OPEN',
      internalStatus: 'CONFIRMED',
      eventName: 'PAYMENT_CONFIRMED',
      source: 'WEBHOOK',
    });

    expect(result).toMatchObject({ kind: 'APPLY', nextLocalStatus: 'PAID' });
  });

  it('gera chave de histórico tenant-scoped e determinística', () => {
    expect(buildPaymentStateTransitionDedupeKey({
      contaId: 'conta-1',
      entityType: 'COBRANCA',
      entityId: 'cob-1',
      source: 'WEBHOOK',
      sourceId: 'evt-1',
    })).toBe('conta-1:COBRANCA:cob-1:WEBHOOK:evt-1');
  });
});
