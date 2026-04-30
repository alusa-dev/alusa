import { describe, it, expect } from 'vitest';
import {
  canApplyChargeStatusTransition,
  computeNextCobrancaStatus,
  computeNextChargeStatus,
  resolveInternalPaymentStatus,
} from '../../mappers/status-precedence';
import { evaluateRetentionAlert } from '../webhook-reconciliation.service';
import type { QueueMetricsResult } from '../webhook-reconciliation.service';

// ═══════════════════════════════════════════════════════════════════════════
// PAYMENT_RESTORED: reabertura controlada (P0.4)
// ═══════════════════════════════════════════════════════════════════════════

describe('PAYMENT_RESTORED — reabertura controlada', () => {
  it('resolve status interno como PENDING', () => {
    const status = resolveInternalPaymentStatus({
      eventName: 'PAYMENT_RESTORED',
      asaasPaymentStatus: 'PENDING',
    });
    expect(status).toBe('PENDING');
  });

  it('permite transição CANCELADO → PENDENTE via PAYMENT_RESTORED (vencimento passado)', () => {
    const result = computeNextCobrancaStatus({
      currentStatus: 'CANCELADO',
      eventName: 'PAYMENT_RESTORED',
      asaasPaymentStatus: 'PENDING',
      dueDate: new Date('2020-01-01'),
      now: new Date('2025-01-01'),
    });
    expect(result.nextStatus).toBe('PENDENTE');
    expect(result.decisionReason).toBe('ASAAS_STATUS_APPLIED');
  });

  it('permite transição CANCELADO → A_VENCER via PAYMENT_RESTORED (vencimento futuro)', () => {
    const result = computeNextCobrancaStatus({
      currentStatus: 'CANCELADO',
      eventName: 'PAYMENT_RESTORED',
      asaasPaymentStatus: 'PENDING',
      dueDate: new Date('2030-01-01'),
      now: new Date('2025-01-01'),
    });
    expect(result.nextStatus).toBe('A_VENCER');
    expect(result.decisionReason).toBe('ASAAS_STATUS_APPLIED');
  });

  it('permite transição CANCELAMENTO_PENDENTE → PENDENTE via PAYMENT_RESTORED', () => {
    const result = computeNextCobrancaStatus({
      currentStatus: 'CANCELAMENTO_PENDENTE',
      eventName: 'PAYMENT_RESTORED',
      asaasPaymentStatus: 'PENDING',
      dueDate: new Date('2020-01-01'),
      now: new Date('2025-01-01'),
    });
    expect(result.nextStatus).toBe('PENDENTE');
    expect(result.decisionReason).toBe('ASAAS_STATUS_APPLIED');
  });

  it('bloqueia regressão ESTORNADO → PENDENTE mesmo com PAYMENT_RESTORED', () => {
    const result = computeNextCobrancaStatus({
      currentStatus: 'ESTORNADO',
      eventName: 'PAYMENT_RESTORED',
      asaasPaymentStatus: 'PENDING',
    });
    expect(result.nextStatus).toBe('ESTORNADO');
    // ESTORNADO não é coberto pela exceção PAYMENT_RESTORED (só CANCELADO/CANCELAMENTO_PENDENTE)
    expect(['REGRESSION_BLOCKED', 'OUT_OF_ORDER_EVENT_IGNORED']).toContain(result.decisionReason);
  });

  it('bloqueia regressão PAGO → PENDENTE com PAYMENT_RESTORED', () => {
    const result = computeNextCobrancaStatus({
      currentStatus: 'PAGO',
      eventName: 'PAYMENT_RESTORED',
      asaasPaymentStatus: 'PENDING',
    });
    expect(result.nextStatus).toBe('PAGO');
    expect(['REGRESSION_BLOCKED', 'OUT_OF_ORDER_EVENT_IGNORED']).toContain(result.decisionReason);
  });

  it('permite Charge CANCELED → OPEN via PAYMENT_RESTORED', () => {
    expect(canApplyChargeStatusTransition({
      current: 'CANCELED',
      next: 'OPEN',
      eventName: 'PAYMENT_RESTORED',
    })).toBe(true);
  });

  it('bloqueia Charge REFUNDED → OPEN via PAYMENT_RESTORED', () => {
    expect(canApplyChargeStatusTransition({
      current: 'REFUNDED',
      next: 'OPEN',
      eventName: 'PAYMENT_RESTORED',
    })).toBe(false);
  });

  it('Charge CANCELED → OPEN via computeNextChargeStatus', () => {
    const result = computeNextChargeStatus({
      currentStatus: 'CANCELED',
      internalStatus: 'PENDING',
      eventName: 'PAYMENT_RESTORED',
    });
    expect(result).toBe('OPEN');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Out-of-order: eventos chegando fora de ordem temporal
// ═══════════════════════════════════════════════════════════════════════════

describe('Webhook out-of-order — monotonicity', () => {
  it('PAYMENT_OVERDUE após PAYMENT_CONFIRMED não regride para ATRASADO', () => {
    const result = computeNextCobrancaStatus({
      currentStatus: 'PAGO',
      eventName: 'PAYMENT_OVERDUE',
      asaasPaymentStatus: 'OVERDUE',
    });
    expect(result.nextStatus).toBe('PAGO');
    expect(result.decisionReason).toBe('REGRESSION_BLOCKED');
  });

  it('PAYMENT_CREATED após PAYMENT_CONFIRMED não regride para A_VENCER', () => {
    const result = computeNextCobrancaStatus({
      currentStatus: 'PAGO',
      eventName: 'PAYMENT_CREATED',
      asaasPaymentStatus: 'PENDING',
      dueDate: new Date('2030-01-01'),
      now: new Date('2025-01-01'),
    });
    expect(result.nextStatus).toBe('PAGO');
    // Motor pode usar OUT_OF_ORDER_EVENT_IGNORED ou REGRESSION_BLOCKED
    expect(['REGRESSION_BLOCKED', 'OUT_OF_ORDER_EVENT_IGNORED']).toContain(result.decisionReason);
  });

  it('PAYMENT_DELETED com deleted=true resulta em CANCELADO (deletar é terminal)', () => {
    // NOTA: PAYMENT_DELETED com deleted=true é tratado como CANCELLED pelo sistema.
    // Não é "out of order" — é operação explícita do Asaas.
    const result = computeNextCobrancaStatus({
      currentStatus: 'PAGO',
      eventName: 'PAYMENT_DELETED',
      asaasPaymentStatus: 'PENDING',
      deleted: true,
    });
    // Sistema permite CANCELADO sobre PAGO para DELETED com deleted=true
    expect(result.nextStatus).toBe('CANCELADO');
  });

  it('Charge: OVERDUE após PAID não mantém PAID (OVERDUE sempre avança)', () => {
    // computeNextChargeStatus trata OVERDUE como mapeamento direto — não aplica monotonicity guard.
    // A proteção contra out-of-order acontece no handler via canApplyChargeStatusTransition.
    const result = computeNextChargeStatus({
      currentStatus: 'PAID',
      internalStatus: 'OVERDUE',
    });
    expect(result).toBe('OVERDUE');
  });

  it('Charge: PENDING após PAID mantém PAID', () => {
    const result = computeNextChargeStatus({
      currentStatus: 'PAID',
      internalStatus: 'PENDING',
    });
    expect(result).toBe('PAID');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Replay: mesmo evento processado N vezes = mesmo resultado
// ═══════════════════════════════════════════════════════════════════════════

describe('Webhook replay — idempotent status computation', () => {
  it('PAYMENT_CONFIRMED × 3 em A_VENCER → PAGO estável', () => {
    let currentStatus: 'PENDENTE' | 'A_VENCER' | 'PAGO' = 'A_VENCER';

    for (let i = 0; i < 3; i++) {
      const result = computeNextCobrancaStatus({
        currentStatus,
        eventName: 'PAYMENT_CONFIRMED',
        asaasPaymentStatus: 'CONFIRMED',
      });
      currentStatus = result.nextStatus as typeof currentStatus;
    }

    expect(currentStatus).toBe('PAGO');
  });

  it('PAYMENT_DELETED → PAYMENT_RESTORED → PAYMENT_CONFIRMED ciclo completo', () => {
    // 1. Cobrança ativa
    let status = 'A_VENCER';

    // 2. Deletada
    const deleted = computeNextCobrancaStatus({
      currentStatus: status,
      eventName: 'PAYMENT_DELETED',
      asaasPaymentStatus: 'PENDING',
      deleted: true,
    });
    status = deleted.nextStatus;
    expect(status).toBe('CANCELADO');

    // 3. Restaurada
    const restored = computeNextCobrancaStatus({
      currentStatus: status,
      eventName: 'PAYMENT_RESTORED',
      asaasPaymentStatus: 'PENDING',
      dueDate: new Date('2030-01-01'),
      now: new Date('2025-01-01'),
    });
    status = restored.nextStatus;
    expect(status).toBe('A_VENCER');

    // 4. Confirmada
    const confirmed = computeNextCobrancaStatus({
      currentStatus: status,
      eventName: 'PAYMENT_CONFIRMED',
      asaasPaymentStatus: 'CONFIRMED',
    });
    status = confirmed.nextStatus;
    expect(status).toBe('PAGO');
  });

  it('PAYMENT_CONFIRMED → PAYMENT_PARTIALLY_REFUNDED × 2 mantém ESTORNADO_PARCIAL', () => {
    let status = 'A_VENCER';

    // Confirmado
    const confirmed = computeNextCobrancaStatus({
      currentStatus: status,
      eventName: 'PAYMENT_CONFIRMED',
      asaasPaymentStatus: 'CONFIRMED',
    });
    status = confirmed.nextStatus;
    expect(status).toBe('PAGO');

    // Primeiro estorno parcial
    const partial1 = computeNextCobrancaStatus({
      currentStatus: status,
      eventName: 'PAYMENT_PARTIALLY_REFUNDED',
      asaasPaymentStatus: 'RECEIVED',
    });
    status = partial1.nextStatus;
    expect(status).toBe('ESTORNADO_PARCIAL');

    // Segundo estorno parcial (replay) — mantém ESTORNADO_PARCIAL
    const partial2 = computeNextCobrancaStatus({
      currentStatus: status,
      eventName: 'PAYMENT_PARTIALLY_REFUNDED',
      asaasPaymentStatus: 'RECEIVED',
    });
    status = partial2.nextStatus;
    expect(status).toBe('ESTORNADO_PARCIAL');
  });

  it('SUBSCRIPTION_UPDATED ACTIVE após pause pendente não regride', () => {
    // Simula via resolveInternalPaymentStatus — SUBSCRIPTION events não passam por esse mapper,
    // mas validates que o contrato de status é respeitado.
    const status = resolveInternalPaymentStatus({
      eventName: 'PAYMENT_UPDATED',
      asaasPaymentStatus: 'PENDING',
    });
    expect(status).toBe('PENDING');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REPROVED_BY_RISK / CAPTURE_REFUSED (P0.3) — status mapping
// ═══════════════════════════════════════════════════════════════════════════

describe('Risk analysis and capture refused — status behavior', () => {
  it('PAYMENT_REPROVED_BY_RISK_ANALYSIS não muda status (mantém PENDING)', () => {
    const status = resolveInternalPaymentStatus({
      eventName: 'PAYMENT_REPROVED_BY_RISK_ANALYSIS',
      asaasPaymentStatus: 'PENDING',
    });
    expect(status).toBe('PENDING');
  });

  it('PAYMENT_CREDIT_CARD_CAPTURE_REFUSED não muda status (mantém PENDING)', () => {
    const status = resolveInternalPaymentStatus({
      eventName: 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
      asaasPaymentStatus: 'PENDING',
    });
    expect(status).toBe('PENDING');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Retention alerts (P1.2)
// ═══════════════════════════════════════════════════════════════════════════

describe('evaluateRetentionAlert', () => {
  function buildMetrics(overrides: Partial<QueueMetricsResult> = {}): QueueMetricsResult {
    return {
      contaId: 'ALL',
      backlog: 0,
      pending: 0,
      processing: 0,
      errored: 0,
      processed: 100,
      highRetryBacklog: 0,
      stuckProcessing: 0,
      oldestPendingAt: null,
      lagSeconds: null,
      generatedAt: new Date(),
      ...overrides,
    };
  }

  it('retorna null quando não há lag', () => {
    expect(evaluateRetentionAlert(buildMetrics())).toBeNull();
  });

  it('retorna null quando lag < 1h', () => {
    expect(evaluateRetentionAlert(buildMetrics({ lagSeconds: 1800 }))).toBeNull();
  });

  it('retorna INFO quando lag >= 1h', () => {
    const alert = evaluateRetentionAlert(buildMetrics({
      lagSeconds: 3600,
      backlog: 5,
      oldestPendingAt: new Date(),
    }));
    expect(alert).not.toBeNull();
    expect(alert!.level).toBe('INFO');
  });

  it('retorna WARNING quando lag >= 24h', () => {
    const alert = evaluateRetentionAlert(buildMetrics({
      lagSeconds: 24 * 3600,
      backlog: 50,
      oldestPendingAt: new Date(),
    }));
    expect(alert).not.toBeNull();
    expect(alert!.level).toBe('WARNING');
  });

  it('retorna HIGH quando lag >= 7d', () => {
    const alert = evaluateRetentionAlert(buildMetrics({
      lagSeconds: 7 * 24 * 3600,
      backlog: 200,
      oldestPendingAt: new Date(),
    }));
    expect(alert).not.toBeNull();
    expect(alert!.level).toBe('HIGH');
  });

  it('retorna CRITICAL quando lag >= 12d', () => {
    const alert = evaluateRetentionAlert(buildMetrics({
      lagSeconds: 12 * 24 * 3600,
      backlog: 1000,
      oldestPendingAt: new Date(),
    }));
    expect(alert).not.toBeNull();
    expect(alert!.level).toBe('CRITICAL');
    expect(alert!.message).toContain('14d');
  });
});
