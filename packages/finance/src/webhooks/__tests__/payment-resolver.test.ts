import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma before import
vi.mock('@alusa/database', () => ({
  prisma: {
    subscription: { findFirst: vi.fn() },
    installmentPlan: { findFirst: vi.fn() },
    charge: { findFirst: vi.fn() },
    cobranca: { findFirst: vi.fn() },
    matricula: { findFirst: vi.fn() },
  },
}));

import { prisma } from '@alusa/database';
import {
  resolvePaymentToLocalEntity,
  isSubscriptionPayment,
  isInstallmentPayment,
  isStandalonePayment,
} from '../payment-resolver';

describe('resolvePaymentToLocalEntity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('por externalReference', () => {
    it('resolve subscription por externalReference subscription:{id}', async () => {
      const subId = 'sub-123';
      vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({
        id: subId,
        matriculaId: 'mat-1',
      });
      vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({ id: 'cob-1' });

      const result = await resolvePaymentToLocalEntity({
        contaId: 'conta-1',
        asaasPaymentId: 'pay_123',
        externalReference: `subscription:${subId}`,
      });

      expect(result).toEqual({
        type: 'subscription',
        subscriptionId: subId,
        cobrancaId: 'cob-1',
      });
    });

    it('resolve installmentPlan por externalReference', async () => {
      const planId = 'plan-456';
      vi.mocked(prisma.installmentPlan.findFirst).mockResolvedValueOnce({
        id: planId,
        matriculaId: 'mat-2',
      });
      vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({ id: 'cob-2' });

      const result = await resolvePaymentToLocalEntity({
        contaId: 'conta-1',
        asaasPaymentId: 'pay_456',
        externalReference: `installmentPlan:${planId}`,
      });

      expect(result).toEqual({
        type: 'installmentPlan',
        installmentPlanId: planId,
        cobrancaId: 'cob-2',
      });
    });

    it('resolve standalone charge por externalReference standalone:', async () => {
      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
        id: 'charge-1',
        cobrancaId: null,
      });

      const result = await resolvePaymentToLocalEntity({
        contaId: 'conta-1',
        asaasPaymentId: 'pay_789',
        externalReference: 'standalone:abc123',
      });

      expect(result).toEqual({
        type: 'charge',
        chargeId: 'charge-1',
        cobrancaId: undefined,
      });
    });
  });

  describe('por asaasPaymentId', () => {
    it('resolve cobranca por asaasPaymentId quando externalReference não encontra', async () => {
      // Passo 1: ExternalReference subscription:inexistente não encontra subscription
      vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce(null);
      
      // Passo 1.5: Busca direta por externalReference no Charge (não encontra)
      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null);
      
      // Passo 2: asaasPaymentId encontra cobranca
      vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({ id: 'cob-3' } as any);
      
      // Busca charge vinculado (opcional)
      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({ id: 'charge-2' } as any);

      const result = await resolvePaymentToLocalEntity({
        contaId: 'conta-1',
        asaasPaymentId: 'pay_abc',
        externalReference: 'subscription:inexistente',
      });

      expect(result).toEqual({
        type: 'cobranca',
        cobrancaId: 'cob-3',
        chargeId: 'charge-2',
      });
    });
  });

  describe('por asaasSubscriptionId', () => {
    it('resolve por asaasSubscriptionId quando outras buscas falham', async () => {
      // Passo 2: asaasPaymentId não encontra cobranca
      vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null);
      
      // Passo 2: asaasPaymentId não encontra charge
      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null);
      
      // Passo 3: asaasSubscriptionId encontra subscription
      vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({
        id: 'sub-999',
        matriculaId: 'mat-5',
      } as any);

      const result = await resolvePaymentToLocalEntity({
        contaId: 'conta-1',
        asaasPaymentId: 'pay_xyz',
        asaasSubscriptionId: 'asaas_sub_123',
        // Sem externalReference para pular o passo 1 completamente
      });

      expect(result).toEqual({
        type: 'subscription',
        subscriptionId: 'sub-999',
        cobrancaId: undefined,
      });
    });
  });

  describe('not_found', () => {
    it('retorna not_found quando nada encontrado', async () => {
      vi.mocked(prisma.cobranca.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.charge.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.subscription.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.installmentPlan.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.matricula.findFirst).mockResolvedValue(null);

      const result = await resolvePaymentToLocalEntity({
        contaId: 'conta-1',
        asaasPaymentId: 'pay_notfound',
      });

      expect(result).toEqual({
        type: 'not_found',
        reason: 'no_matching_entity',
      });
    });
  });
});

describe('isSubscriptionPayment', () => {
  it('retorna true para subscriptionId presente', () => {
    expect(isSubscriptionPayment(null, 'sub_123')).toBe(true);
  });

  it('retorna true para externalReference subscription:', () => {
    expect(isSubscriptionPayment('subscription:abc', null)).toBe(true);
  });

  it('retorna false para outros externalReference', () => {
    expect(isSubscriptionPayment('standalone:abc', null)).toBe(false);
    expect(isSubscriptionPayment('installmentPlan:abc', null)).toBe(false);
  });
});

describe('isInstallmentPayment', () => {
  it('retorna true para installmentId presente', () => {
    expect(isInstallmentPayment(null, 'inst_123')).toBe(true);
  });

  it('retorna true para externalReference installmentPlan:', () => {
    expect(isInstallmentPayment('installmentPlan:abc', null)).toBe(true);
  });

  it('retorna false para outros', () => {
    expect(isInstallmentPayment('subscription:abc', null)).toBe(false);
  });
});

describe('isStandalonePayment', () => {
  it('retorna true para standalone:', () => {
    expect(isStandalonePayment('standalone:abc')).toBe(true);
  });

  it('retorna true para standaloneCharge:', () => {
    expect(isStandalonePayment('standaloneCharge:abc')).toBe(true);
  });

  it('retorna false para subscription:', () => {
    expect(isStandalonePayment('subscription:abc')).toBe(false);
  });

  it('retorna false para null/undefined', () => {
    expect(isStandalonePayment(null)).toBe(false);
    expect(isStandalonePayment(undefined)).toBe(false);
  });
});
