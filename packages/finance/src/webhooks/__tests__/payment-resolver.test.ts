import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma before import
vi.mock('@alusa/database', () => ({
  prisma: {
    subscription: { findFirst: vi.fn() },
    standaloneSubscription: { findFirst: vi.fn() },
    installmentPlan: { findFirst: vi.fn() },
    standaloneInstallmentPlan: { findFirst: vi.fn() },
    charge: { findFirst: vi.fn(), findMany: vi.fn() },
    cobranca: { findFirst: vi.fn(), findMany: vi.fn() },
    matricula: { findFirst: vi.fn() },
    asaasResourceOrigin: { findUnique: vi.fn() },
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
    vi.resetAllMocks();
    vi.mocked(prisma.cobranca.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.charge.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.asaasResourceOrigin.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.standaloneSubscription.findFirst).mockResolvedValue(null as never);
  });

  it('reconhece pagamento recorrente com assinatura externa classificada no mesmo tenant', async () => {
    vi.mocked(prisma.asaasResourceOrigin.findUnique)
      .mockResolvedValueOnce({ origin: 'EXTERNAL' } as never)
      .mockResolvedValueOnce(null as never);
    const result = await resolvePaymentToLocalEntity({
      contaId: 'conta-a', asaasPaymentId: 'pay-a', asaasSubscriptionId: 'sub-a',
    });
    expect(result).toEqual({ type: 'external', resourceType: 'SUBSCRIPTION', asaasId: 'sub-a' });
    expect(prisma.asaasResourceOrigin.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { uq_asaas_resource_origin_tenant_resource: { contaId: 'conta-a', resourceType: 'SUBSCRIPTION', asaasId: 'sub-a' } },
    }));
  });

  it('mantém uma assinatura externa em Conta B desconhecida para Conta A', async () => {
    vi.mocked(prisma.asaasResourceOrigin.findUnique).mockResolvedValue(null as never);
    const result = await resolvePaymentToLocalEntity({
      contaId: 'conta-a', asaasPaymentId: 'pay-a', asaasSubscriptionId: 'sub-shared-id',
    });
    expect(result).toEqual({ type: 'unknown', reason: 'no_matching_entity_or_origin' });
    expect(prisma.asaasResourceOrigin.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { uq_asaas_resource_origin_tenant_resource: { contaId: 'conta-a', resourceType: 'SUBSCRIPTION', asaasId: 'sub-shared-id' } },
    }));
  });

  it('não deixa pagamento externo mascarar uma origem Alusa em outro tipo de recurso', async () => {
    vi.mocked(prisma.asaasResourceOrigin.findUnique)
      .mockResolvedValueOnce({ origin: 'ALUSA' } as never)
      .mockResolvedValueOnce({ origin: 'EXTERNAL' } as never)
      .mockResolvedValueOnce(null as never);
    const result = await resolvePaymentToLocalEntity({
      contaId: 'conta-a', asaasPaymentId: 'pay-a', asaasSubscriptionId: 'sub-a', asaasInstallmentId: 'inst-a',
    });
    expect(result).toEqual({ type: 'conflict', reason: 'payment_id_mapped_to_different_entity' });
  });

  describe('por externalReference', () => {
    it.each(['asaasPaymentId', 'asaasId'] as const)(
      'sinaliza conflito quando %s aponta para outra matrícula que a referência V2',
      async () => {
        vi.mocked(prisma.cobranca.findMany).mockResolvedValueOnce([{
          id: 'cobranca-matricula-b', matriculaId: 'mat-b',
        }] as never);
        vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({
          id: 'subscription-a', matriculaId: 'mat-a',
        } as never);

        const result = await resolvePaymentToLocalEntity({
          contaId: 'conta-a',
          asaasPaymentId: 'pay-already-linked',
          externalReference: 'alusa:subscription:mat-a:plan-a',
        });

        expect(result).toEqual({ type: 'conflict', reason: 'payment_id_mapped_to_different_entity' });
        expect(prisma.cobranca.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({
            contaId: 'conta-a',
            matricula: { contaId: 'conta-a', aluno: { contaId: 'conta-a' } },
            OR: [{ asaasPaymentId: 'pay-already-linked' }, { asaasId: 'pay-already-linked' }],
          }),
          take: 2,
        }));
      },
    );

    it('usa o vínculo global exato do payment quando bate com a matrícula V2, mesmo sem vencimento', async () => {
      vi.mocked(prisma.cobranca.findMany).mockResolvedValueOnce([{
        id: 'cobranca-a', matriculaId: 'mat-a',
      }] as never);
      vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({
        id: 'subscription-a', matriculaId: 'mat-a',
      } as never);

      const result = await resolvePaymentToLocalEntity({
        contaId: 'conta-a',
        asaasPaymentId: 'pay-exact-a',
        externalReference: 'alusa:subscription:mat-a:plan-a',
      });

      expect(result).toEqual({ type: 'cobranca', cobrancaId: 'cobranca-a' });
      expect(prisma.cobranca.findMany).toHaveBeenCalledTimes(1);
    });

    it.each([null, 'cobranca-de-outra-entidade'])(
      'bloqueia referência V2 quando o payment ID já existe em Charge com cobrancaId=%s',
      async (chargeCobrancaId) => {
        vi.mocked(prisma.charge.findMany).mockResolvedValueOnce([{
          id: 'charge-existing', cobrancaId: chargeCobrancaId,
        }] as never);
        vi.mocked(prisma.cobranca.findMany)
          .mockResolvedValueOnce([] as never)
          .mockResolvedValueOnce([{ id: 'cobranca-v2', matriculaId: 'mat-a' }] as never);
        vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({
          id: 'subscription-a', matriculaId: 'mat-a',
        } as never);
        vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);

        const result = await resolvePaymentToLocalEntity({
          contaId: 'conta-a',
          asaasPaymentId: 'pay-reused',
          externalReference: 'alusa:subscription:mat-a:plan-a',
          dueDate: '2026-08-15',
        });

        expect(result).toEqual({ type: 'conflict', reason: 'payment_id_mapped_to_different_entity' });
        expect(prisma.charge.findMany).toHaveBeenCalledWith({
          where: { contaId: 'conta-a', asaasPaymentId: 'pay-reused' },
          select: { id: true, cobrancaId: true },
          take: 2,
        });
      },
    );

    it('resolve a referência V2 exata da assinatura para uma única mensalidade aberta', async () => {
      const externalReference = 'alusa:subscription:mat-a:plan-a';
      vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({
        id: 'subscription-a',
        matriculaId: 'mat-a',
      } as never);
      vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
      vi.mocked(prisma.cobranca.findMany)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([{ id: 'cobranca-a' }] as never);

      const result = await resolvePaymentToLocalEntity({
        contaId: 'conta-a',
        asaasPaymentId: 'pay-a',
        externalReference,
        dueDate: '2026-08-15',
      });

      expect(result).toEqual({ type: 'cobranca', cobrancaId: 'cobranca-a' });
      expect(prisma.subscription.findFirst).toHaveBeenCalledWith({
        where: {
          contaId: 'conta-a',
          externalReference,
          matricula: { contaId: 'conta-a', aluno: { contaId: 'conta-a' } },
        },
        select: { id: true, matriculaId: true },
      });
      expect(prisma.cobranca.findFirst).toHaveBeenCalledWith({
        where: {
          contaId: 'conta-a',
          matriculaId: 'mat-a',
          matricula: { contaId: 'conta-a', aluno: { contaId: 'conta-a' } },
          OR: [{ asaasPaymentId: 'pay-a' }, { asaasId: 'pay-a' }],
        },
        select: { id: true },
      });
      expect(prisma.cobranca.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          contaId: 'conta-a',
          matriculaId: 'mat-a',
          matricula: { contaId: 'conta-a', aluno: { contaId: 'conta-a' } },
          tipo: 'MENSALIDADE',
          asaasPaymentId: null,
          asaasId: null,
          status: { in: ['PENDENTE', 'A_VENCER', 'ATRASADO'] },
          vencimento: {
            gte: new Date('2026-08-15T00:00:00.000Z'),
            lt: new Date('2026-08-16T00:00:00.000Z'),
          },
        }),
        take: 2,
      }));
    });

    it.each([
      { label: 'sem vencimento', dueDate: undefined, matches: [{ id: 'cobranca-a' }] },
      { label: 'com vencimentos ambiguos', dueDate: '2026-08-15', matches: [{ id: 'cobranca-a' }, { id: 'cobranca-a2' }] },
      { label: 'com vencimento inválido', dueDate: '2026-02-30', matches: [{ id: 'cobranca-a' }] },
    ])('não resolve referência V2 $label', async ({ dueDate, matches }) => {
      vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({
        id: 'subscription-a',
        matriculaId: 'mat-a',
      } as never);
      vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
      vi.mocked(prisma.cobranca.findMany).mockResolvedValueOnce([] as never);
      if (dueDate) vi.mocked(prisma.cobranca.findMany).mockResolvedValueOnce(matches as never);

      const result = await resolvePaymentToLocalEntity({
        contaId: 'conta-a',
        asaasPaymentId: 'pay-a',
        externalReference: 'alusa:subscription:mat-a:plan-a',
        dueDate,
      });

      expect(result).toEqual({ type: 'not_found', reason: 'subscription_reference_without_unique_charge' });
      if (!dueDate || dueDate === '2026-02-30') expect(prisma.cobranca.findMany).toHaveBeenCalledTimes(1);
    });

    it.each([
      { label: 'sem vencimento', dueDate: undefined },
      { label: 'com vencimentos ambiguos', dueDate: '2026-08-15' },
    ])('prefere payment ID exato na referência V2 $label', async ({ dueDate }) => {
      vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({
        id: 'subscription-a',
        matriculaId: 'mat-a',
      } as never);
      vi.mocked(prisma.cobranca.findMany).mockResolvedValueOnce([{
        id: 'cobranca-exact-a', matriculaId: 'mat-a',
      }] as never);

      const result = await resolvePaymentToLocalEntity({
        contaId: 'conta-a',
        asaasPaymentId: 'pay-a',
        externalReference: 'alusa:subscription:mat-a:plan-a',
        dueDate,
      });

      expect(result).toEqual({ type: 'cobranca', cobrancaId: 'cobranca-exact-a' });
      expect(prisma.cobranca.findMany).toHaveBeenCalledTimes(1);
    });

    it('não usa subscriptionId do Asaas quando a referência V2 não tem Subscription exata', async () => {
      vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce(null as never);
      vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);

      const result = await resolvePaymentToLocalEntity({
        contaId: 'conta-a',
        asaasPaymentId: 'pay-a',
        externalReference: 'alusa:subscription:mat-a:plan-a',
        asaasSubscriptionId: 'asaas-subscription-a',
        dueDate: '2026-08-15',
      });

      expect(result).toEqual({ type: 'not_found', reason: 'subscription_reference_without_unique_charge' });
      expect(prisma.subscription.findFirst).toHaveBeenCalledTimes(2);
      expect(prisma.matricula.findFirst).toHaveBeenCalledWith({
        where: { contaId: 'conta-a', aluno: { contaId: 'conta-a' }, asaasSubscriptionId: 'asaas-subscription-a' },
        select: { id: true },
      });
      expect(prisma.installmentPlan.findFirst).not.toHaveBeenCalled();
    });

    it('sinaliza conflito quando referência V2 diverge de Charge standalone ligado ao payment', async () => {
      vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce(null as never);
      vi.mocked(prisma.charge.findMany).mockResolvedValueOnce([{
        id: 'standalone-charge', cobrancaId: null,
      }] as never);

      const result = await resolvePaymentToLocalEntity({
        contaId: 'conta-a',
        asaasPaymentId: 'pay-standalone-reused',
        externalReference: 'alusa:subscription:mat-a:plan-a',
        dueDate: '2026-08-15',
      });

      expect(result).toEqual({ type: 'conflict', reason: 'payment_id_mapped_to_different_entity' });
      expect(prisma.charge.findFirst).toHaveBeenCalledWith({
        where: { contaId: 'conta-a', externalReference: 'alusa:subscription:mat-a:plan-a' },
        select: { id: true, cobrancaId: true },
      });
    });

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
      expect(prisma.subscription.findFirst).toHaveBeenCalledWith({
        where: { contaId: 'conta-1', id: subId, matricula: { contaId: 'conta-1', aluno: { contaId: 'conta-1' } } },
        select: { id: true, matriculaId: true },
      });
      expect(prisma.cobranca.findFirst).toHaveBeenCalledWith({
        where: {
          contaId: 'conta-1',
          matriculaId: 'mat-1',
          asaasPaymentId: 'pay_123',
          matricula: { contaId: 'conta-1', aluno: { contaId: 'conta-1' } },
        },
        select: { id: true },
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
      expect(prisma.installmentPlan.findFirst).toHaveBeenCalledWith({
        where: { contaId: 'conta-1', id: planId, matricula: { contaId: 'conta-1', aluno: { contaId: 'conta-1' } } },
        select: { id: true, matriculaId: true },
      });
      expect(prisma.cobranca.findFirst).toHaveBeenCalledWith({
        where: {
          contaId: 'conta-1',
          matriculaId: 'mat-2',
          asaasPaymentId: 'pay_456',
          matricula: { contaId: 'conta-1', aluno: { contaId: 'conta-1' } },
        },
        select: { id: true },
      });
    });

    it.each([
      { kind: 'subscription', externalReference: 'subscription:sub-123' },
      { kind: 'installmentPlan', externalReference: 'installmentPlan:plan-456' },
    ])('retorna conflito para $kind quando Charge ligada ao payment aponta para outra entidade', async ({ kind, externalReference }) => {
      vi.mocked(prisma.charge.findMany).mockResolvedValueOnce([{
        id: 'charge-payment-link', cobrancaId: 'cobranca-outro-destino',
      }] as never);
      if (kind === 'subscription') {
        vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({ id: 'sub-123', matriculaId: 'mat-1' } as never);
      } else {
        vi.mocked(prisma.installmentPlan.findFirst).mockResolvedValueOnce({ id: 'plan-456', matriculaId: 'mat-1' } as never);
      }
      vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);

      const result = await resolvePaymentToLocalEntity({
        contaId: 'conta-1', asaasPaymentId: 'pay-linked', externalReference,
      });

      expect(result).toEqual({ type: 'conflict', reason: 'payment_id_mapped_to_different_entity' });
      expect(prisma.cobranca.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 'cobranca-outro-destino', contaId: 'conta-1', matriculaId: 'mat-1' }),
      }));
    });

    it.each([
      { kind: 'subscription', externalReference: 'subscription:sub-123' },
      { kind: 'installmentPlan', externalReference: 'installmentPlan:plan-456' },
    ])('aceita Charge $kind que espelha a mesma Cobranca do destino', async ({ kind, externalReference }) => {
      vi.mocked(prisma.charge.findMany).mockResolvedValueOnce([{
        id: 'charge-payment-link', cobrancaId: 'cobranca-destino',
      }] as never);
      if (kind === 'subscription') {
        vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({ id: 'sub-123', matriculaId: 'mat-1' } as never);
      } else {
        vi.mocked(prisma.installmentPlan.findFirst).mockResolvedValueOnce({ id: 'plan-456', matriculaId: 'mat-1' } as never);
      }
      vi.mocked(prisma.cobranca.findFirst)
        .mockResolvedValueOnce({ id: 'cobranca-destino' } as never)
        .mockResolvedValueOnce(null as never);

      const result = await resolvePaymentToLocalEntity({
        contaId: 'conta-1', asaasPaymentId: 'pay-linked', externalReference,
      });

      expect(result).toMatchObject({
        type: kind,
        cobrancaId: 'cobranca-destino',
      });
    });

    it.each([
      { kind: 'subscription', externalReference: 'subscription:sub-123' },
      { kind: 'installmentPlan', externalReference: 'installmentPlan:plan-456' },
    ])('rejeita Charge $kind ligada ao payment sem Cobranca local', async ({ kind, externalReference }) => {
      vi.mocked(prisma.charge.findMany).mockResolvedValueOnce([{
        id: 'charge-payment-link', cobrancaId: null,
      }] as never);
      if (kind === 'subscription') {
        vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce({ id: 'sub-123', matriculaId: 'mat-1' } as never);
      } else {
        vi.mocked(prisma.installmentPlan.findFirst).mockResolvedValueOnce({ id: 'plan-456', matriculaId: 'mat-1' } as never);
      }

      const result = await resolvePaymentToLocalEntity({
        contaId: 'conta-1', asaasPaymentId: 'pay-linked', externalReference,
      });

      expect(result).toEqual({ type: 'conflict', reason: 'payment_id_mapped_to_different_entity' });
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

    it('retorna conflito quando payment ID e standalone: apontam para Charges diferentes', async () => {
      vi.mocked(prisma.charge.findMany).mockResolvedValueOnce([{
        id: 'charge-a', cobrancaId: null,
      }] as never);
      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
        id: 'charge-b', cobrancaId: null,
      } as never);

      const result = await resolvePaymentToLocalEntity({
        contaId: 'conta-a',
        asaasPaymentId: 'pay-a',
        externalReference: 'standalone:request-b',
      });

      expect(result).toEqual({ type: 'conflict', reason: 'payment_id_mapped_to_different_entity' });
      expect(prisma.charge.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { contaId: 'conta-a', asaasPaymentId: 'pay-a' },
      }));
    });

    it('resolve Charge com cobrancaId como cobranca acadêmica', async () => {
      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
        id: 'charge-academic-1',
        cobrancaId: 'cobranca-1',
      });

      const result = await resolvePaymentToLocalEntity({
        contaId: 'conta-1',
        asaasPaymentId: 'pay_academic_1',
        externalReference: 'standalone:legacy-academic-ref',
      });

      expect(result).toEqual({
        type: 'cobranca',
        cobrancaId: 'cobranca-1',
        chargeId: 'charge-academic-1',
      });
    });

    it('resolve charge:{cobrancaId} com busca de cobrança tenant-scoped', async () => {
      vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({ id: 'cobranca-parsed' });
      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({ id: 'charge-parsed' });

      const result = await resolvePaymentToLocalEntity({
        contaId: 'conta-1',
        asaasPaymentId: 'pay_parsed',
        externalReference: 'charge:cobranca-parsed',
      });

      expect(result).toEqual({
        type: 'cobranca',
        cobrancaId: 'cobranca-parsed',
        chargeId: 'charge-parsed',
      });
      expect(prisma.cobranca.findFirst).toHaveBeenCalledWith({
        where: {
          contaId: 'conta-1',
          id: 'cobranca-parsed',
          matricula: { contaId: 'conta-1', aluno: { contaId: 'conta-1' } },
        },
        select: { id: true },
      });
      expect(prisma.charge.findFirst).toHaveBeenCalledWith({
        where: { cobrancaId: 'cobranca-parsed', contaId: 'conta-1' },
        select: { id: true },
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
      vi.mocked(prisma.cobranca.findMany).mockResolvedValueOnce([{
        id: 'cob-3', matriculaId: 'mat-3',
      }] as never);
      
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
      expect(prisma.cobranca.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          contaId: 'conta-1',
          matricula: { contaId: 'conta-1', aluno: { contaId: 'conta-1' } },
          OR: [{ asaasPaymentId: 'pay_abc' }, { asaasId: 'pay_abc' }],
        }),
        take: 2,
      }));
    });

    it('resolve por asaasPaymentId como cobranca quando só a Charge espelho é encontrada', async () => {
      vi.mocked(prisma.charge.findMany).mockResolvedValueOnce([{
        id: 'charge-academic-2',
        cobrancaId: 'cobranca-2',
      }] as never);

      const result = await resolvePaymentToLocalEntity({
        contaId: 'conta-1',
        asaasPaymentId: 'pay_academic_2',
      });

      expect(result).toEqual({
        type: 'cobranca',
        cobrancaId: 'cobranca-2',
        chargeId: 'charge-academic-2',
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
      expect(prisma.subscription.findFirst).toHaveBeenCalledWith({
        where: {
          contaId: 'conta-1',
          asaasSubscriptionId: 'asaas_sub_123',
          matricula: { contaId: 'conta-1', aluno: { contaId: 'conta-1' } },
        },
        select: { id: true, matriculaId: true },
      });
    });

    it('escopa a matrícula do fallback legado diretamente pela conta e pelo aluno', async () => {
      vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.subscription.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.matricula.findFirst).mockResolvedValueOnce({ id: 'mat-legacy-a' } as never);

      const result = await resolvePaymentToLocalEntity({
        contaId: 'conta-a',
        asaasPaymentId: 'pay-a',
        asaasSubscriptionId: 'asaas_sub_a',
      });

      expect(result).toEqual({
        type: 'subscription',
        subscriptionId: 'legacy:matricula:mat-legacy-a',
        cobrancaId: undefined,
      });
      expect(prisma.matricula.findFirst).toHaveBeenCalledWith({
        where: {
          contaId: 'conta-a',
          aluno: { contaId: 'conta-a' },
          asaasSubscriptionId: 'asaas_sub_a',
        },
        select: { id: true },
      });
    });
  });

  describe('por asaasInstallmentId', () => {
  it('não resolve plano da conta A ligado a matrícula e aluno da conta B', async () => {
      vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.installmentPlan.findFirst).mockResolvedValueOnce({
        id: 'installment-plan-a',
        matricula: {
          contaId: 'conta-b',
          aluno: { contaId: 'conta-b' },
        },
      } as never);

      const result = await resolvePaymentToLocalEntity({
        contaId: 'conta-a',
        asaasPaymentId: 'pay-a',
        asaasInstallmentId: 'asaas-installment-a',
      });

      expect(result).toEqual({ type: 'unknown', reason: 'no_matching_entity_or_origin' });
      expect(prisma.installmentPlan.findFirst).toHaveBeenCalledWith({
        where: {
          contaId: 'conta-a',
          asaasInstallmentId: 'asaas-installment-a',
          matricula: { contaId: 'conta-a', aluno: { contaId: 'conta-a' } },
        },
        select: {
          id: true,
          matricula: { select: { contaId: true, aluno: { select: { contaId: true } } } },
        },
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
        type: 'unknown',
        reason: 'no_matching_entity_or_origin',
      });
    });
  });

  it('herda a classificação externa pelo ID exato do parcelamento no mesmo tenant', async () => {
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.installmentPlan.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.standaloneInstallmentPlan.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.asaasResourceOrigin.findUnique)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ origin: 'EXTERNAL' } as never);

    const result = await resolvePaymentToLocalEntity({ contaId: 'conta-a', asaasPaymentId: 'pay-a', asaasInstallmentId: 'inst-a' });
    expect(result).toEqual({ type: 'external', resourceType: 'INSTALLMENT', asaasId: 'inst-a' });
    expect(prisma.asaasResourceOrigin.findUnique).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { uq_asaas_resource_origin_tenant_resource: { contaId: 'conta-a', resourceType: 'INSTALLMENT', asaasId: 'inst-a' } },
    }));
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
