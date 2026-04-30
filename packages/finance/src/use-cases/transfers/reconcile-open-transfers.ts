import { prisma, loadAsaasCredentials } from '@alusa/database';
import { getTransfer as asaasGetTransfer } from '@alusa/asaas';
import type { AsaasTransfer } from '@alusa/asaas';
import type { Prisma } from '@prisma/client';
import type { TransferStatus } from '@prisma/client';

import { auditLogService } from '../../foundation/audit-log.service';
import {
  isAllowedTransition,
  isOpenTransferStatus,
  mapTransferStatusToPixTransferSessionStatus,
  resolveTransferStatus,
} from './transfer-status';

const DEFAULT_LIMIT = 20;
const DEFAULT_MIN_AGE_MS = 30_000;

export type ReconcileOpenTransfersInput = {
  contaId: string;
  limit?: number;
  minAgeMs?: number;
};

export type ReconcileResult = {
  reconciled: number;
  officialTransfersById: Map<string, AsaasTransfer>;
};

export async function reconcileOpenTransfers(input: ReconcileOpenTransfersInput): Promise<ReconcileResult> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const minAgeMs = input.minAgeMs ?? DEFAULT_MIN_AGE_MS;

  const credentials = await loadAsaasCredentials(input.contaId);
  const officialTransfersById = new Map<string, AsaasTransfer>();

  if (!credentials) {
    return { reconciled: 0, officialTransfersById };
  }

  const staleBefore = new Date(Date.now() - minAgeMs);
  const openTransfers = await prisma.transferRequest.findMany({
    where: {
      contaId: input.contaId,
      asaasTransferId: { not: null },
      statusUpdatedAt: { lt: staleBefore },
    },
    orderBy: { statusUpdatedAt: 'asc' },
    take: limit,
    select: {
      id: true,
      asaasTransferId: true,
      externalReference: true,
      status: true,
      authorized: true,
    },
  });

  let reconciled = 0;

  for (const openTransfer of openTransfers) {
    if (!openTransfer.asaasTransferId || !isOpenTransferStatus(openTransfer.status as TransferStatus)) {
      continue;
    }

    try {
      const officialTransfer = await asaasGetTransfer({
        apiKey: credentials.apiKey,
        id: openTransfer.asaasTransferId,
      });
      officialTransfersById.set(openTransfer.asaasTransferId, officialTransfer);

      const nextStatus = resolveTransferStatus({ asaasStatus: officialTransfer.status });

      // Detecta mudanca de authorized (ex: SMS token confirmado pelo usuario).
      // authorized: false -> true sem mudar status PENDING.
      const authorizedChanged =
        typeof officialTransfer.authorized === 'boolean' &&
        officialTransfer.authorized !== openTransfer.authorized;

      const hasStatusChange = nextStatus && nextStatus !== openTransfer.status;

      // Nada a fazer se status igual e authorized nao mudou
      if (!hasStatusChange && !authorizedChanged) continue;

      if (hasStatusChange && !isAllowedTransition(openTransfer.status as TransferStatus, nextStatus!)) {
        console.warn('[finance][reconcileOpenTransfers][state-regression-blocked]', {
          contaId: input.contaId,
          transferRequestId: openTransfer.id,
          currentStatus: openTransfer.status,
          attemptedStatus: nextStatus,
        });
        // Ainda pode atualizar authorized mesmo que a transicao de status seja invalida
        if (!authorizedChanged) continue;
      }

          const updateData: Prisma.TransferRequestUpdateInput = {
        rawAsaasStatus: officialTransfer.status,
        authorized: typeof officialTransfer.authorized === 'boolean' ? officialTransfer.authorized : undefined,
        failReason: officialTransfer.failReason ?? undefined,
        transactionReceiptUrl: officialTransfer.transactionReceiptUrl ?? undefined,
        effectiveDate: officialTransfer.effectiveDate ?? undefined,
      };

      if (hasStatusChange && isAllowedTransition(openTransfer.status as TransferStatus, nextStatus!)) {
        updateData.status = nextStatus;
        updateData.statusUpdatedAt = new Date();
      }

      await prisma.transferRequest.update({
        where: { id: openTransfer.id },
        data: updateData,
      });

      const resolvedNextStatus = hasStatusChange && nextStatus ? nextStatus : (openTransfer.status as TransferStatus);
      const nextPixTransferSessionStatus = mapTransferStatusToPixTransferSessionStatus(resolvedNextStatus);
      if (nextPixTransferSessionStatus) {
        await prisma.pixTransferSession.updateMany({
          where: {
            contaId: input.contaId,
            confirmTransferRequestId: openTransfer.id,
          },
          data: {
            status: nextPixTransferSessionStatus,
          },
        });
      }

      await auditLogService.record({
        contaId: input.contaId,
        action: 'finance.transfer.reconciled_from_asaas',
        entity: { type: 'TransferRequest', id: openTransfer.id },
        metadata: {
          asaasTransferId: openTransfer.asaasTransferId,
          externalReference: openTransfer.externalReference,
          previousStatus: openTransfer.status,
          nextStatus: updateData.status ?? null,
          asaasStatus: officialTransfer.status,
          authorizedChanged,
          authorizedNow: officialTransfer.authorized,
        },
      });

      reconciled++;
    } catch (error) {
      console.warn('[finance][reconcileOpenTransfers]', {
        contaId: input.contaId,
        transferRequestId: openTransfer.id,
        asaasTransferId: openTransfer.asaasTransferId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { reconciled, officialTransfersById };
}
