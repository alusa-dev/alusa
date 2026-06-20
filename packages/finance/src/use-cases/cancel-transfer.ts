import { prisma, loadAsaasCredentials } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';
import { cancelTransfer as asaasCancelTransfer, getTransfer as asaasGetTransfer } from '@alusa/asaas';
import type { TransferStatus } from '@prisma/client';

import { auditLogService } from '../foundation/audit-log.service';
import { ensureWebhookConfigOperational } from '../webhooks/ensure-webhook-config-operational';
import { isCancellableAsaasTransfer, resolveTransferOperationFromAsaas } from './transfers/asaas-transfer-payload';
import { mapAsaasTransferStatus } from './transfers/transfer-status';
import { resolveOfficialFeeValue, resolveOfficialNetValue } from './transfers/transfer-metadata';

export type CancelTransferInput = {
  contaId: string;
  transferId: string;
  actor: { type: 'USER' | 'SYSTEM' | 'ADMIN'; id?: string };
};

export type CancelTransferOutput = {
  transferId: string;
  asaasTransferId: string | null;
  externalReference: string;
  status: TransferStatus;
  statusUpdatedAt: string;
};

export type CancelTransferError =
  | 'TRANSFER_NAO_ENCONTRADA'
  | 'TRANSFER_SEM_ID_ASAAS'
  | 'TRANSFER_NAO_CANCELAVEL'
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'ERRO_AO_CANCELAR_TRANSFER'
  | 'ERRO_INTERNO';

export async function cancelTransfer(
  input: CancelTransferInput,
): Promise<Result<CancelTransferOutput, CancelTransferError>> {
  try {
    const transfer = await prisma.transferRequest.findFirst({
      where: { id: input.transferId, contaId: input.contaId },
      select: {
        id: true,
        externalReference: true,
        asaasTransferId: true,
        status: true,
      },
    });

    if (!transfer) return err('TRANSFER_NAO_ENCONTRADA');

    // Transfer created locally but never registered at Asaas (Asaas call failed or is in-flight).
    // Safe to cancel locally — no remote resource exists.
    if (!transfer.asaasTransferId) {
      if (transfer.status !== 'REQUESTED') return err('TRANSFER_SEM_ID_ASAAS');

      const updated = await prisma.transferRequest.update({
        where: { id: transfer.id },
        data: { status: 'CANCELED', statusUpdatedAt: new Date() },
        select: {
          id: true,
          externalReference: true,
          asaasTransferId: true,
          status: true,
          statusUpdatedAt: true,
        },
      });

      await auditLogService.record({
        contaId: input.contaId,
        actor: input.actor,
        action: 'finance.transfer.canceled.locally',
        entity: { type: 'TransferRequest', id: updated.id },
        metadata: {
          reason: 'no_asaas_id_requested_status',
          previousStatus: 'REQUESTED',
        },
      });

      return ok({
        transferId: updated.id,
        asaasTransferId: null,
        externalReference: updated.externalReference,
        status: updated.status,
        statusUpdatedAt: updated.statusUpdatedAt.toISOString(),
      });
    }

    const credentials = await loadAsaasCredentials(input.contaId);
    if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

    await ensureWebhookConfigOperational(input.contaId);

    const currentRemote = await asaasGetTransfer({
      apiKey: credentials.apiKey,
      id: transfer.asaasTransferId,
    });

    if (currentRemote.status === 'CANCELLED') {
      const updated = await prisma.transferRequest.update({
        where: { id: transfer.id },
        data: {
          status: 'CANCELED',
          statusUpdatedAt: new Date(),
          rawAsaasStatus: currentRemote.status,
          authorized: currentRemote.authorized ?? undefined,
          failReason: currentRemote.failReason ?? null,
          transactionReceiptUrl: currentRemote.transactionReceiptUrl ?? null,
          effectiveDate: currentRemote.effectiveDate ?? null,
          endToEndIdentifier: currentRemote.endToEndIdentifier ?? null,
          feeValue: resolveOfficialFeeValue(currentRemote, null, currentRemote.value),
          netValue: resolveOfficialNetValue(currentRemote, null, currentRemote.value),
          resolvedOperation: resolveTransferOperationFromAsaas(currentRemote.operationType),
        },
        select: {
          id: true,
          externalReference: true,
          asaasTransferId: true,
          status: true,
          statusUpdatedAt: true,
        },
      });

      await auditLogService.record({
        contaId: input.contaId,
        actor: input.actor,
        action: 'finance.transfer.cancel.replayed',
        entity: { type: 'TransferRequest', id: updated.id },
        metadata: {
          asaasTransferId: updated.asaasTransferId,
          previousStatus: transfer.status,
          remoteStatus: currentRemote.status,
        },
      });

      return ok({
        transferId: updated.id,
        asaasTransferId: updated.asaasTransferId ?? transfer.asaasTransferId,
        externalReference: updated.externalReference,
        status: updated.status,
        statusUpdatedAt: updated.statusUpdatedAt.toISOString(),
      });
    }

    if (!isCancellableAsaasTransfer(currentRemote)) {
      console.warn('[finance][cancelTransfer][not-cancellable]', {
        contaId: input.contaId,
        transferId: input.transferId,
        asaasTransferId: transfer.asaasTransferId,
        remoteStatus: currentRemote.status,
        canBeCancelled: currentRemote.canBeCancelled,
        authorized: currentRemote.authorized,
      });
      return err('TRANSFER_NAO_CANCELAVEL');
    }

    await auditLogService.record({
      contaId: input.contaId,
      actor: input.actor,
      action: 'finance.transfer.cancel.requested',
      entity: { type: 'TransferRequest', id: transfer.id },
      metadata: {
        asaasTransferId: transfer.asaasTransferId,
        externalReference: transfer.externalReference,
        remoteStatusBeforeCancel: currentRemote.status,
      },
    });

    await asaasCancelTransfer({
      apiKey: credentials.apiKey,
      id: transfer.asaasTransferId,
    });

    const confirmedRemote = await asaasGetTransfer({
      apiKey: credentials.apiKey,
      id: transfer.asaasTransferId,
    });

    const mappedStatus = mapAsaasTransferStatus(confirmedRemote.status);
    if (!mappedStatus) {
      console.warn('[finance][cancelTransfer][unknown-asaas-status]', {
        contaId: input.contaId,
        asaasTransferId: transfer.asaasTransferId,
        rawStatus: confirmedRemote.status,
      });
    }
    const nextStatus: TransferStatus = mappedStatus ?? 'PENDING';
    const updated = await prisma.transferRequest.update({
      where: { id: transfer.id },
      data: {
        status: nextStatus,
        statusUpdatedAt: new Date(),
        rawAsaasStatus: confirmedRemote.status,
        authorized: confirmedRemote.authorized ?? undefined,
        failReason: confirmedRemote.failReason ?? null,
        transactionReceiptUrl: confirmedRemote.transactionReceiptUrl ?? null,
        effectiveDate: confirmedRemote.effectiveDate ?? null,
        endToEndIdentifier: confirmedRemote.endToEndIdentifier ?? null,
        feeValue: resolveOfficialFeeValue(confirmedRemote, null, confirmedRemote.value),
        netValue: resolveOfficialNetValue(confirmedRemote, null, confirmedRemote.value),
        resolvedOperation: resolveTransferOperationFromAsaas(confirmedRemote.operationType),
      },
      select: {
        id: true,
        externalReference: true,
        asaasTransferId: true,
        status: true,
        statusUpdatedAt: true,
      },
    });

    await auditLogService.record({
      contaId: input.contaId,
      actor: input.actor,
      action: 'finance.transfer.canceled',
      entity: { type: 'TransferRequest', id: updated.id },
      metadata: {
        asaasTransferId: updated.asaasTransferId,
        previousStatus: transfer.status,
        remoteStatusAfterCancel: confirmedRemote.status,
        rawAsaasStatus: confirmedRemote.status,
        failReason: confirmedRemote.failReason ?? null,
      },
    });

    return ok({
      transferId: updated.id,
      asaasTransferId: updated.asaasTransferId ?? transfer.asaasTransferId,
      externalReference: updated.externalReference,
      status: updated.status,
      statusUpdatedAt: updated.statusUpdatedAt.toISOString(),
    });
  } catch (error) {
    console.error('[finance][cancelTransfer]', error);
    return err('ERRO_AO_CANCELAR_TRANSFER');
  }
}
