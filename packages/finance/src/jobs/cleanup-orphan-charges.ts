/**
 * Job: cleanup-orphan-charges.ts
 *
 * Cancela cobrancas locais orfas (sem asaasPaymentId) criadas ha X horas.
 * Regra: nao deve existir cobranca local sem confirmacao do Asaas.
 */

import { prisma } from '@alusa/database';

import { auditLogService } from '../foundation/audit-log.service';

const DEFAULT_OLDER_THAN_HOURS = 24;
const MAX_CHARGES_PER_RUN = 200;

export interface CleanupOrphanChargesInput {
  contaId?: string;
  olderThanHours?: number;
  dryRun?: boolean;
  actor?: { type: 'SYSTEM' | 'USER'; id: string };
}

export interface CleanupOrphanChargesResult {
  processadas: number;
  canceladas: number;
  skipped: number;
  erros: Array<{ chargeId: string; erro: string }>;
  dataExecucao: Date;
}

export async function cleanupOrphanChargesJob(
  input: CleanupOrphanChargesInput = {}
): Promise<CleanupOrphanChargesResult> {
  const {
    contaId,
    olderThanHours = DEFAULT_OLDER_THAN_HOURS,
    dryRun = false,
    actor = { type: 'SYSTEM', id: 'cleanup-orphan-charges' },
  } = input;

  const result: CleanupOrphanChargesResult = {
    processadas: 0,
    canceladas: 0,
    skipped: 0,
    erros: [],
    dataExecucao: new Date(),
  };

  const now = new Date();
  const threshold = new Date(now.getTime() - olderThanHours * 60 * 60 * 1000);

  const charges = await prisma.charge.findMany({
    where: {
      status: 'CREATED',
      asaasPaymentId: null,
      createdAt: { lt: threshold },
      ...(contaId ? { contaId } : {}),
    },
    select: {
      id: true,
      contaId: true,
      cobrancaId: true,
      externalReference: true,
      createdAt: true,
      status: true,
    },
    orderBy: { createdAt: 'asc' },
    take: MAX_CHARGES_PER_RUN,
  });

  for (const charge of charges) {
    result.processadas++;

    try {
      if (dryRun) {
        console.log('[cleanup-orphan-charges] DRY RUN - Would cancel:', {
          chargeId: charge.id,
          contaId: charge.contaId,
          cobrancaId: charge.cobrancaId,
          createdAt: charge.createdAt,
          externalReference: charge.externalReference,
        });
        result.canceladas++;
        continue;
      }

      await prisma.$transaction(async (tx) => {
        await tx.charge.update({
          where: { id: charge.id },
          data: {
            status: 'CANCELED',
            statusUpdatedAt: now,
          },
        });

        if (charge.cobrancaId) {
          await tx.cobranca.update({
            where: { id: charge.cobrancaId },
            data: {
              status: 'CANCELADO',
              canceladoEm: now,
              canceladoMotivo: 'Cobranca orfa sem confirmacao do Asaas',
              canceladoPor: actor.id,
            },
          });
        }
      });

      await auditLogService.record({
        contaId: charge.contaId,
        actor,
        action: 'finance.orphan_charge.cleaned',
        entity: { type: 'Charge', id: charge.id },
        metadata: {
          cobrancaId: charge.cobrancaId,
          externalReference: charge.externalReference,
          createdAt: charge.createdAt.toISOString(),
          olderThanHours,
        },
      });

      result.canceladas++;
    } catch (error) {
      result.erros.push({
        chargeId: charge.id,
        erro: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log('[cleanup-orphan-charges] Resultado:', {
    processadas: result.processadas,
    canceladas: result.canceladas,
    erros: result.erros.length,
    dryRun,
  });

  return result;
}
