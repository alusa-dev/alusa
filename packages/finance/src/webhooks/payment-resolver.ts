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
import { logFinanceOperationalEvent } from '../foundation/operational-log';

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
  | { type: 'conflict'; reason: 'payment_id_mapped_to_different_entity' }
  | { type: 'external'; resourceType: 'SUBSCRIPTION' | 'PAYMENT' | 'INSTALLMENT'; asaasId: string }
  | { type: 'unknown'; reason: 'no_matching_entity_or_origin' }
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

function utcDateRange(value: string | null | undefined): { gte: Date; lt: Date } | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const [, year, month, day] = match;
  const start = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    start.getUTCFullYear() !== Number(year) ||
    start.getUTCMonth() !== Number(month) - 1 ||
    start.getUTCDate() !== Number(day)
  ) {
    return null;
  }

  return { gte: start, lt: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

async function findUniqueOpenSubscriptionCharge(input: {
  contaId: string;
  matriculaId: string;
  dueDate?: string | null;
}): Promise<string | null> {
  const dueDateRange = utcDateRange(input.dueDate);
  if (!dueDateRange) return null;

  const candidates = await prisma.cobranca.findMany({
    where: {
      contaId: input.contaId,
      matriculaId: input.matriculaId,
      matricula: { contaId: input.contaId, aluno: { contaId: input.contaId } },
      tipo: 'MENSALIDADE',
      asaasPaymentId: null,
      asaasId: null,
      status: { in: ['PENDENTE', 'A_VENCER', 'ATRASADO'] },
      vencimento: dueDateRange,
    },
    select: { id: true },
    take: 2,
  });

  return candidates.length === 1 ? candidates[0]?.id ?? null : null;
}

async function findChargeMappingForMatricula(input: {
  contaId: string;
  chargeCobrancaId: string | null;
  matriculaId: string;
}): Promise<string | null | 'conflict'> {
  if (!input.chargeCobrancaId) return 'conflict';
  const mappedCobranca = await prisma.cobranca.findFirst({
    where: {
      id: input.chargeCobrancaId,
      contaId: input.contaId,
      matriculaId: input.matriculaId,
      matricula: { contaId: input.contaId, aluno: { contaId: input.contaId } },
    },
    select: { id: true },
  });
  return mappedCobranca?.id ?? 'conflict';
}

/**
 * Resolver de Payment do Asaas → Entidade Local
 * Usa ordem de precedência determinística
 */
export async function resolvePaymentToLocalEntity(
  input: PaymentResolveInput
): Promise<PaymentResolveResult> {
  const { contaId, asaasPaymentId, externalReference } = input;
  const isCanonicalV2SubscriptionReference = externalReference?.startsWith('alusa:subscription:') ?? false;
  const chargesByPaymentId = await prisma.charge.findMany({
    where: { contaId, asaasPaymentId },
    select: { id: true, cobrancaId: true },
    take: 2,
  });
  if (chargesByPaymentId.length > 1) {
    return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
  }
  const chargeByPaymentId = chargesByPaymentId[0] ?? null;
  // The provider ID and externalReference must not resolve to two different
  // Charge rows. This also covers legacy `charge:` / `standalone:` references.
  if (chargeByPaymentId && externalReference) {
    const chargeByExternalReference = await prisma.charge.findFirst({
      where: { contaId, externalReference },
      select: { id: true, cobrancaId: true },
    });
    if (chargeByExternalReference && chargeByExternalReference.id !== chargeByPaymentId.id) {
      return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
    }
  }
  const cobrancasByPaymentId = await prisma.cobranca.findMany({
    where: {
      contaId,
      matricula: { contaId, aluno: { contaId } },
      OR: [{ asaasPaymentId }, { asaasId: asaasPaymentId }],
    },
    select: { id: true, matriculaId: true },
    take: 2,
  });
  if (cobrancasByPaymentId.length > 1) {
    return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
  }
  const cobrancaByPaymentId = cobrancasByPaymentId[0] ?? null;
  if (
    chargeByPaymentId &&
    cobrancaByPaymentId &&
    chargeByPaymentId.cobrancaId !== cobrancaByPaymentId.id
  ) {
    return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Resolver por externalReference (preferência máxima)
  // ─────────────────────────────────────────────────────────────────────────
  if (externalReference) {
    const parsed = parseExternalReference(externalReference);

    // V2 subscription references encode matrícula/plano IDs, while the
    // authoritative Subscription row stores the exact full reference.
    if (isCanonicalV2SubscriptionReference) {
      const subscriptionByReference = await prisma.subscription.findFirst({
        where: { contaId, externalReference, matricula: { contaId, aluno: { contaId } } },
        select: { id: true, matriculaId: true },
      });
      const providerSubscription = input.asaasSubscriptionId
        ? await prisma.subscription.findFirst({
            where: {
              contaId,
              asaasSubscriptionId: input.asaasSubscriptionId,
              matricula: { contaId, aluno: { contaId } },
            },
            select: { matriculaId: true },
          })
        : null;
      const providerMatricula = input.asaasSubscriptionId && !providerSubscription
        ? await prisma.matricula.findFirst({
            where: { contaId, aluno: { contaId }, asaasSubscriptionId: input.asaasSubscriptionId },
            select: { id: true },
          })
        : null;

      const parsedV2 = parseExternalReferenceV2(externalReference);
      const referencedMatriculaId = subscriptionByReference?.matriculaId ?? parsedV2?.ids.matriculaId;
      if (chargeByPaymentId && chargeByPaymentId.cobrancaId === null) {
        return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
      }
      if (
        subscriptionByReference &&
        (providerSubscription || providerMatricula) &&
        subscriptionByReference.matriculaId !== (providerSubscription?.matriculaId ?? providerMatricula?.id)
      ) {
        return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
      }
      if (cobrancaByPaymentId && referencedMatriculaId && cobrancaByPaymentId.matriculaId !== referencedMatriculaId) {
        return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
      }
      if (cobrancaByPaymentId && referencedMatriculaId === cobrancaByPaymentId.matriculaId) {
        return { type: 'cobranca', cobrancaId: cobrancaByPaymentId.id };
      }

      if (subscriptionByReference) {
        const localPaymentLink = await prisma.cobranca.findFirst({
          where: {
            contaId,
            matriculaId: subscriptionByReference.matriculaId,
            matricula: { contaId, aluno: { contaId } },
            OR: [{ asaasPaymentId }, { asaasId: asaasPaymentId }],
          },
          select: { id: true },
        });
        if (localPaymentLink) {
          if (chargeByPaymentId && chargeByPaymentId.cobrancaId !== localPaymentLink.id) {
            return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
          }
          return { type: 'cobranca', cobrancaId: localPaymentLink.id };
        }
        const cobrancaId = await findUniqueOpenSubscriptionCharge({
          contaId,
          matriculaId: subscriptionByReference.matriculaId,
          dueDate: input.dueDate,
        });

        if (cobrancaId && chargeByPaymentId && chargeByPaymentId.cobrancaId !== cobrancaId) {
          return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
        }
        return cobrancaId
          ? { type: 'cobranca', cobrancaId }
          : { type: 'not_found', reason: 'subscription_reference_without_unique_charge' };
      }

      // A canonical academic subscription reference is authoritative. Do not
      // let a Charge found by provider ID or raw externalReference turn an
      // unresolved/conflicting academic payment into a standalone payment.
      if (!subscriptionByReference) {
        return { type: 'not_found', reason: 'subscription_reference_without_unique_charge' };
      }
    }

    if (parsed && !isCanonicalV2SubscriptionReference) {
      switch (parsed.type) {
        case 'subscription': {
          const subscription = await prisma.subscription.findFirst({
            where: { contaId, id: parsed.id, matricula: { contaId, aluno: { contaId } } },
            select: { id: true, matriculaId: true },
          });
          if (subscription) {
            const chargeMappedCobrancaId = chargeByPaymentId
              ? await findChargeMappingForMatricula({
                  contaId,
                  chargeCobrancaId: chargeByPaymentId.cobrancaId,
                  matriculaId: subscription.matriculaId,
                })
              : null;
            if (chargeMappedCobrancaId === 'conflict') {
              return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
            }
            if (cobrancaByPaymentId && cobrancaByPaymentId.matriculaId !== subscription.matriculaId) {
              return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
            }
            if (cobrancaByPaymentId && chargeMappedCobrancaId && chargeMappedCobrancaId !== cobrancaByPaymentId.id) {
              return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
            }
            const cobranca = cobrancaByPaymentId?.matriculaId === subscription.matriculaId ? cobrancaByPaymentId : null;
            if (cobrancaByPaymentId && !cobranca) return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
            const localPaymentLink = cobranca ? null : await prisma.cobranca.findFirst({
              where: {
                contaId,
                matriculaId: subscription.matriculaId,
                asaasPaymentId,
                matricula: { contaId, aluno: { contaId } },
              },
              select: { id: true },
            });
            return {
              type: 'subscription',
              subscriptionId: subscription.id,
              cobrancaId: cobranca?.id ?? localPaymentLink?.id ?? chargeMappedCobrancaId ?? undefined,
            };
          }
          break;
        }

        case 'installmentPlan': {
          const installmentPlan = await prisma.installmentPlan.findFirst({
            where: { contaId, id: parsed.id, matricula: { contaId, aluno: { contaId } } },
            select: { id: true, matriculaId: true },
          });
          if (installmentPlan) {
            const chargeMappedCobrancaId = chargeByPaymentId
              ? await findChargeMappingForMatricula({
                  contaId,
                  chargeCobrancaId: chargeByPaymentId.cobrancaId,
                  matriculaId: installmentPlan.matriculaId,
                })
              : null;
            if (chargeMappedCobrancaId === 'conflict') {
              return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
            }
            if (cobrancaByPaymentId && cobrancaByPaymentId.matriculaId !== installmentPlan.matriculaId) {
              return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
            }
            if (cobrancaByPaymentId && chargeMappedCobrancaId && chargeMappedCobrancaId !== cobrancaByPaymentId.id) {
              return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
            }
            const cobranca = cobrancaByPaymentId?.matriculaId === installmentPlan.matriculaId ? cobrancaByPaymentId : null;
            const localPaymentLink = cobranca ? null : await prisma.cobranca.findFirst({
              where: {
                contaId,
                matriculaId: installmentPlan.matriculaId,
                asaasPaymentId,
                matricula: { contaId, aluno: { contaId } },
              },
              select: { id: true },
            });
            return {
              type: 'installmentPlan',
              installmentPlanId: installmentPlan.id,
              cobrancaId: cobranca?.id ?? localPaymentLink?.id ?? chargeMappedCobrancaId ?? undefined,
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
            if (chargeByPaymentId && charge.id !== chargeByPaymentId.id) {
              return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
            }
            if (cobrancaByPaymentId) {
              if (charge.cobrancaId === cobrancaByPaymentId.id) {
                return { type: 'cobranca', cobrancaId: cobrancaByPaymentId.id, chargeId: charge.id };
              }
              return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
            }
            if (charge.cobrancaId) {
              return {
                type: 'cobranca',
                cobrancaId: charge.cobrancaId,
                chargeId: charge.id,
              };
            }
            return {
              type: 'charge',
              chargeId: charge.id,
            };
          }
          break;
        }

        case 'charge': {
          // charge:{cobrancaId} - prefixo antigo
          if (chargeByPaymentId && chargeByPaymentId.cobrancaId !== parsed.id) {
            return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
          }
          const cobranca = await prisma.cobranca.findFirst({
            where: {
              contaId,
              id: parsed.id,
              matricula: { contaId, aluno: { contaId } },
            },
            select: { id: true },
          });
          if (cobrancaByPaymentId && cobrancaByPaymentId.id !== parsed.id) {
            return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
          }
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
            if (chargeByPaymentId && charge.id !== chargeByPaymentId.id) {
              return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
            }
            if (cobrancaByPaymentId) {
              if (charge.cobrancaId === cobrancaByPaymentId.id) {
                return { type: 'cobranca', cobrancaId: cobrancaByPaymentId.id, chargeId: charge.id };
              }
              return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
            }
            if (charge.cobrancaId) {
              return {
                type: 'cobranca',
                cobrancaId: charge.cobrancaId,
                chargeId: charge.id,
              };
            }
            return {
              type: 'charge',
              chargeId: charge.id,
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
      if (chargeByPaymentId && chargeByRef.id !== chargeByPaymentId.id) {
        return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
      }
      if (cobrancaByPaymentId) {
        if (chargeByRef.cobrancaId === cobrancaByPaymentId.id) {
          return { type: 'cobranca', cobrancaId: cobrancaByPaymentId.id, chargeId: chargeByRef.id };
        }
        return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
      }
      if (chargeByRef.cobrancaId) {
        return {
          type: 'cobranca',
          cobrancaId: chargeByRef.cobrancaId,
          chargeId: chargeByRef.id,
        };
      }
      return {
        type: 'charge',
        chargeId: chargeByRef.id,
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Resolver por asaasPaymentId (busca direta)
  // ─────────────────────────────────────────────────────────────────────────
  if (cobrancaByPaymentId && input.asaasSubscriptionId) {
    const subscription = await prisma.subscription.findFirst({
      where: {
        contaId,
        asaasSubscriptionId: input.asaasSubscriptionId,
        matricula: { contaId, aluno: { contaId } },
      },
      select: { matriculaId: true },
    });
    const matricula = subscription
      ? null
      : await prisma.matricula.findFirst({
          where: { contaId, aluno: { contaId }, asaasSubscriptionId: input.asaasSubscriptionId },
          select: { id: true },
        });
    const expectedMatriculaId = subscription?.matriculaId ?? matricula?.id;
    if (expectedMatriculaId && cobrancaByPaymentId.matriculaId !== expectedMatriculaId) {
      return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
    }
  }

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

  const localCobrancaByPaymentId = await prisma.cobranca.findFirst({
    where: {
      contaId,
      matricula: { contaId, aluno: { contaId } },
      OR: [{ asaasPaymentId }, { asaasId: asaasPaymentId }],
    },
    select: { id: true },
  });
  if (localCobrancaByPaymentId) {
    return { type: 'cobranca', cobrancaId: localCobrancaByPaymentId.id };
  }

  if (chargeByPaymentId) {
    if (chargeByPaymentId.cobrancaId) {
      return {
        type: 'cobranca',
        cobrancaId: chargeByPaymentId.cobrancaId,
        chargeId: chargeByPaymentId.id,
      };
    }
    return {
      type: 'charge',
      chargeId: chargeByPaymentId.id,
    };
  }

  // A canonical V2 subscription reference is authoritative. If neither its
  // exact Subscription nor a payment-ID mapping was found, do not guess from
  // the provider subscription ID or an installment reference.
  if (isCanonicalV2SubscriptionReference) {
    return { type: 'not_found', reason: 'subscription_reference_without_unique_charge' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Resolver por asaasSubscriptionId
  // ─────────────────────────────────────────────────────────────────────────
  if (input.asaasSubscriptionId) {
    const subscription = await prisma.subscription.findFirst({
      where: {
        contaId,
        asaasSubscriptionId: input.asaasSubscriptionId,
        matricula: { contaId, aluno: { contaId } },
      },
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
        contaId,
        aluno: { contaId },
        asaasSubscriptionId: input.asaasSubscriptionId,
      },
      select: { id: true },
    });

    if (matriculaWithSub) {
      // Log para rastreamento de uso legado
      logFinanceOperationalEvent({
        severity: 'warn',
        eventName: 'finance.webhook.payment_resolver.legacy_subscription_fallback',
      });

      return {
        type: 'subscription',
        subscriptionId: `legacy:matricula:${matriculaWithSub.id}`,
        cobrancaId: undefined,
      };
    }
  }

  const standaloneReferenceId = externalReference?.match(/^alusa:standalone-subscription:([^:]+)(?::|$)/)?.[1];
  if (input.asaasSubscriptionId || standaloneReferenceId || externalReference?.startsWith('alusa:standalone-subscription:')) {
    const standaloneSubscription = await prisma.standaloneSubscription.findFirst({
      where: { contaId, OR: [
        ...(input.asaasSubscriptionId ? [{ asaasSubscriptionId: input.asaasSubscriptionId }] : []),
        ...(externalReference ? [{ externalReference }] : []),
        ...(standaloneReferenceId ? [{ id: standaloneReferenceId }] : []),
      ] },
      select: { id: true },
    });
    if (standaloneSubscription) return { type: 'subscription', subscriptionId: standaloneSubscription.id };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Resolver por asaasInstallmentId
  // ─────────────────────────────────────────────────────────────────────────
  if (input.asaasInstallmentId) {
    const installmentPlan = await prisma.installmentPlan.findFirst({
      where: {
        contaId,
        asaasInstallmentId: input.asaasInstallmentId,
        matricula: { contaId, aluno: { contaId } },
      },
      select: {
        id: true,
        matricula: { select: { contaId: true, aluno: { select: { contaId: true } } } },
      },
    });

    if (
      installmentPlan?.matricula.contaId === contaId &&
      installmentPlan.matricula.aluno.contaId === contaId
    ) {
      return {
        type: 'installmentPlan',
        installmentPlanId: installmentPlan.id,
        cobrancaId: undefined,
      };
    }

    const standaloneInstallment = await prisma.standaloneInstallmentPlan.findFirst({
      where: { contaId, asaasInstallmentId: input.asaasInstallmentId },
      select: { id: true },
    });
    if (standaloneInstallment) {
      return { type: 'installmentPlan', installmentPlanId: standaloneInstallment.id, cobrancaId: undefined };
    }
  }

  // Ownership decisions are tenant scoped and are consulted only after all
  // authoritative local mappings. A canonical Alusa reference remains an
  // actionable consistency signal even if somebody attempted to classify it.
  const subscriptionOrigin = input.asaasSubscriptionId
    ? await prisma.asaasResourceOrigin.findUnique({ where: {
        uq_asaas_resource_origin_tenant_resource: {
          contaId, resourceType: 'SUBSCRIPTION', asaasId: input.asaasSubscriptionId,
        },
      }, select: { origin: true } })
    : null;
  const paymentOrigin = await prisma.asaasResourceOrigin.findUnique({ where: {
    uq_asaas_resource_origin_tenant_resource: {
      contaId, resourceType: 'PAYMENT', asaasId: input.asaasPaymentId,
    },
  }, select: { origin: true } });
  const installmentOrigin = input.asaasInstallmentId ? await prisma.asaasResourceOrigin.findUnique({ where: {
    uq_asaas_resource_origin_tenant_resource: {
      contaId, resourceType: 'INSTALLMENT', asaasId: input.asaasInstallmentId,
    },
  }, select: { origin: true } }) : null;
  const alusaReference = Boolean(externalReference && (
    externalReference.startsWith('alusa:') || externalReference.startsWith('enrollment-op:') ||
    externalReference.startsWith('charge:') || externalReference.startsWith('standalone:') ||
    externalReference.startsWith('subscription:') || externalReference.startsWith('installmentPlan:') ||
    externalReference.startsWith('event-map-order:') || externalReference.startsWith('event-entry:')
  ));
  const hasAlusaOrigin = subscriptionOrigin?.origin === 'ALUSA' || paymentOrigin?.origin === 'ALUSA' || installmentOrigin?.origin === 'ALUSA';
  const hasExternalOrigin = subscriptionOrigin?.origin === 'EXTERNAL' || paymentOrigin?.origin === 'EXTERNAL' || installmentOrigin?.origin === 'EXTERNAL';
  if (hasAlusaOrigin && hasExternalOrigin) {
    return { type: 'conflict', reason: 'payment_id_mapped_to_different_entity' };
  }
  if (!alusaReference && subscriptionOrigin?.origin === 'EXTERNAL') {
    return { type: 'external', resourceType: 'SUBSCRIPTION', asaasId: input.asaasSubscriptionId! };
  }
  if (!alusaReference && paymentOrigin?.origin === 'EXTERNAL') {
    return { type: 'external', resourceType: 'PAYMENT', asaasId: input.asaasPaymentId };
  }
  if (!alusaReference && installmentOrigin?.origin === 'EXTERNAL') {
    return { type: 'external', resourceType: 'INSTALLMENT', asaasId: input.asaasInstallmentId! };
  }
  if (alusaReference || subscriptionOrigin?.origin === 'ALUSA' || paymentOrigin?.origin === 'ALUSA' || installmentOrigin?.origin === 'ALUSA') {
    return { type: 'not_found', reason: 'alusa_resource_expected_but_local_entity_missing' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Não encontrado
  // ─────────────────────────────────────────────────────────────────────────
  return { type: 'unknown', reason: 'no_matching_entity_or_origin' };
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
