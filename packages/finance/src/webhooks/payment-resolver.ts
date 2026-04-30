/**
 * Payment Resolver - Resolução determinística de vínculos
 * 
 * FASE 1 da refatoração: Linkagem determinística
 * Ordem de precedência para resolver Payment → Entidade Local:
 * 
 * 1. externalReference (canônico, determinístico) - suporta V1 e V2
 * 2. asaasPaymentId (identificador único do Asaas)
 * 3. asaasSubscriptionId + dueDate (para cobranças de assinatura)
 * 4. asaasInstallmentId + installmentNumber (para parcelamentos)
 * 
 * NÃO USAR (fallbacks perigosos):
 * - Matrícula + competência
 * - Vencimento aproximado
 */

import { prisma } from '@alusa/database';
import { parseExternalReference as parseExternalReferenceV1 } from '@alusa/asaas-gateway';
import { parseExternalReference as parseExternalReferenceV2 } from '../core';

/**
 * Parse externalReference suportando V1 e V2
 */
function parseExternalReference(ref: string | null | undefined) {
  if (!ref) return null;
  
  // Tentar V2 primeiro (prefixo alusa:)
  if (ref.startsWith('alusa:')) {
    const v2Result = parseExternalReferenceV2(ref);
    if (v2Result && v2Result.type !== 'unknown') {
      // Converter para formato compatível com V1
      return {
        type: v2Result.type === 'installment' ? 'installmentPlan' : v2Result.type,
        id: v2Result.ids.installmentPlanId ?? v2Result.ids.subscriptionId ?? 
            v2Result.ids.chargeId ?? v2Result.ids.matriculaId ?? '',
        raw: v2Result.raw,
      };
    }
  }
  
  // Fallback para V1
  return parseExternalReferenceV1(ref);
}

export type PaymentResolveResult =
  | { type: 'cobranca'; cobrancaId: string; chargeId?: string }
  | { type: 'charge'; chargeId: string; cobrancaId?: string }
  | { type: 'subscription'; subscriptionId: string; cobrancaId?: string }
  | { type: 'installmentPlan'; installmentPlanId: string; cobrancaId?: string }
  | { type: 'not_found'; reason: string };

export type PaymentResolveInput = {
  contaId: string;
  asaasPaymentId: string;
  externalReference?: string | null;
  asaasSubscriptionId?: string | null;
  asaasInstallmentId?: string | null;
  dueDate?: string | null;
  installmentNumber?: number | null;
};

/**
 * Resolver de Payment do Asaas → Entidade Local
 * Usa ordem de precedência determinística
 */
export async function resolvePaymentToLocalEntity(
  input: PaymentResolveInput
): Promise<PaymentResolveResult> {
  const { contaId, asaasPaymentId, externalReference } = input;

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Resolver por externalReference (preferência máxima)
  // ─────────────────────────────────────────────────────────────────────────
  if (externalReference) {
    const parsed = parseExternalReference(externalReference);

    if (parsed) {
      switch (parsed.type) {
        case 'subscription': {
          const subscription = await prisma.subscription.findFirst({
            where: { contaId, id: parsed.id },
            select: { id: true, matriculaId: true },
          });
          if (subscription) {
            // Buscar cobrança vinculada (se existir)
            const cobranca = await prisma.cobranca.findFirst({
              where: {
                matriculaId: subscription.matriculaId,
                asaasPaymentId,
              },
              select: { id: true },
            });
            return {
              type: 'subscription',
              subscriptionId: subscription.id,
              cobrancaId: cobranca?.id,
            };
          }
          break;
        }

        case 'installmentPlan': {
          const installmentPlan = await prisma.installmentPlan.findFirst({
            where: { contaId, id: parsed.id },
            select: { id: true, matriculaId: true },
          });
          if (installmentPlan) {
            const cobranca = await prisma.cobranca.findFirst({
              where: {
                matriculaId: installmentPlan.matriculaId,
                asaasPaymentId,
              },
              select: { id: true },
            });
            return {
              type: 'installmentPlan',
              installmentPlanId: installmentPlan.id,
              cobrancaId: cobranca?.id,
            };
          }
          break;
        }

        case 'standaloneCharge': {
          const charge = await prisma.charge.findFirst({
            where: {
              contaId,
              OR: [{ id: parsed.id }, { externalReference }],
            },
            select: { id: true, cobrancaId: true },
          });
          if (charge) {
            return {
              type: 'charge',
              chargeId: charge.id,
              cobrancaId: charge.cobrancaId ?? undefined,
            };
          }
          break;
        }

        case 'charge': {
          // charge:{cobrancaId} - prefixo antigo
          const cobranca = await prisma.cobranca.findFirst({
            where: {
              id: parsed.id,
              matricula: { aluno: { contaId } },
            },
            select: { id: true },
          });
          if (cobranca) {
            // Buscar Charge vinculado
            const charge = await prisma.charge.findFirst({
              where: { cobrancaId: cobranca.id, contaId },
              select: { id: true },
            });
            return {
              type: 'cobranca',
              cobrancaId: cobranca.id,
              chargeId: charge?.id,
            };
          }
          break;
        }

        case 'standalone': {
          // standalone:{idempotencyKey} - legacy
          const charge = await prisma.charge.findFirst({
            where: {
              contaId,
              externalReference,
            },
            select: { id: true, cobrancaId: true },
          });
          if (charge) {
            return {
              type: 'charge',
              chargeId: charge.id,
              cobrancaId: charge.cobrancaId ?? undefined,
            };
          }
          break;
        }

        case 'transfer': {
          // Transfers não são cobranças, ignorar
          return { type: 'not_found', reason: 'transfer_not_charge' };
        }
      }
    }

    // ExternalReference não parseável, tentar busca direta
    const chargeByRef = await prisma.charge.findFirst({
      where: { contaId, externalReference },
      select: { id: true, cobrancaId: true },
    });
    if (chargeByRef) {
      return {
        type: 'charge',
        chargeId: chargeByRef.id,
        cobrancaId: chargeByRef.cobrancaId ?? undefined,
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Resolver por asaasPaymentId (busca direta)
  // ─────────────────────────────────────────────────────────────────────────
  const cobrancaByPaymentId = await prisma.cobranca.findFirst({
    where: {
      matricula: { aluno: { contaId } },
      OR: [{ asaasPaymentId }, { asaasId: asaasPaymentId }],
    },
    select: { id: true },
  });

  if (cobrancaByPaymentId) {
    const charge = await prisma.charge.findFirst({
      where: { cobrancaId: cobrancaByPaymentId.id, contaId },
      select: { id: true },
    });
    return {
      type: 'cobranca',
      cobrancaId: cobrancaByPaymentId.id,
      chargeId: charge?.id,
    };
  }

  const chargeByPaymentId = await prisma.charge.findFirst({
    where: { contaId, asaasPaymentId },
    select: { id: true, cobrancaId: true },
  });

  if (chargeByPaymentId) {
    return {
      type: 'charge',
      chargeId: chargeByPaymentId.id,
      cobrancaId: chargeByPaymentId.cobrancaId ?? undefined,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Resolver por asaasSubscriptionId
  // ─────────────────────────────────────────────────────────────────────────
  if (input.asaasSubscriptionId) {
    const subscription = await prisma.subscription.findFirst({
      where: { contaId, asaasSubscriptionId: input.asaasSubscriptionId },
      select: { id: true, matriculaId: true },
    });

    if (subscription) {
      return {
        type: 'subscription',
        subscriptionId: subscription.id,
        cobrancaId: undefined,
      };
    }

    // Fallback: matrícula com asaasSubscriptionId direto (legado)
    const matriculaWithSub = await prisma.matricula.findFirst({
      where: {
        aluno: { contaId },
        asaasSubscriptionId: input.asaasSubscriptionId,
      },
      select: { id: true },
    });

    if (matriculaWithSub) {
      // Log para rastreamento de uso legado
      console.warn('[payment-resolver] Fallback legado: matrícula com asaasSubscriptionId direto', {
        contaId,
        asaasPaymentId,
        asaasSubscriptionId: input.asaasSubscriptionId,
        matriculaId: matriculaWithSub.id,
      });

      return {
        type: 'subscription',
        subscriptionId: `legacy:matricula:${matriculaWithSub.id}`,
        cobrancaId: undefined,
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Resolver por asaasInstallmentId
  // ─────────────────────────────────────────────────────────────────────────
  if (input.asaasInstallmentId) {
    const installmentPlan = await prisma.installmentPlan.findFirst({
      where: { contaId, asaasInstallmentId: input.asaasInstallmentId },
      select: { id: true },
    });

    if (installmentPlan) {
      return {
        type: 'installmentPlan',
        installmentPlanId: installmentPlan.id,
        cobrancaId: undefined,
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Não encontrado
  // ─────────────────────────────────────────────────────────────────────────
  return {
    type: 'not_found',
    reason: 'no_matching_entity',
  };
}

/**
 * Verifica se o pagamento pertence a uma Subscription
 */
export function isSubscriptionPayment(externalRef?: string | null, subscriptionId?: string | null): boolean {
  if (subscriptionId) return true;
  if (!externalRef) return false;
  const parsed = parseExternalReference(externalRef);
  return parsed?.type === 'subscription';
}

/**
 * Verifica se o pagamento pertence a um InstallmentPlan
 */
export function isInstallmentPayment(externalRef?: string | null, installmentId?: string | null): boolean {
  if (installmentId) return true;
  if (!externalRef) return false;
  const parsed = parseExternalReference(externalRef);
  return parsed?.type === 'installmentPlan';
}

/**
 * Verifica se o pagamento é standalone (sem vínculo com matrícula)
 */
export function isStandalonePayment(externalRef?: string | null): boolean {
  if (!externalRef) return false;
  const parsed = parseExternalReference(externalRef);
  return parsed?.type === 'standaloneCharge' || parsed?.type === 'standalone';
}
