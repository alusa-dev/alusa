import { prisma, loadAsaasCredentials } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';
import { AsaasHttpError, createBankTransfer, createPixTransfer, getTransfer as asaasGetTransfer } from '@alusa/asaas';
import type { TransferStatus } from '@prisma/client';

import { auditLogService } from '../foundation/audit-log.service';
import { classifyAsaasOperationalError } from '../foundation/asaas-operational-error';
import { featureFlagsService } from '../foundation/feature-flags.service';
import { financeProfileService } from '../foundation/finance-profile.service';
import { isPendingDocumentsBlockBypassedForTesting } from '../foundation/kyc-test-bypass';
import { ensureWebhookConfigOperational } from '../webhooks/ensure-webhook-config-operational';
import { getBalance } from './get-balance';
import { mapAsaasTransferStatus } from './transfers/transfer-status';

export type WithdrawDestination =
  | {
      type: 'PIX';
      pixAddressKey: string;
      pixAddressKeyType: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP';
      saveRecipient?: boolean;
      recipientName?: string;
      recipientDocumentMasked?: string;
      recipientBank?: string;
      recipientPixKeyMasked?: string;
    }
  | {
      type: 'BANK_ACCOUNT';
      bank: { code: string };
      accountName?: string;
      ownerName: string;
      ownerBirthDate?: string;
      cpfCnpj: string;
      agency: string;
      account: string;
      accountDigit: string;
      bankAccountType?: 'CONTA_CORRENTE' | 'CONTA_POUPANCA';
      ispb?: string;
    };

export type RequestWithdrawInput = {
  contaId: string;
  value: number;
  destination: WithdrawDestination;
  description?: string;
  scheduleDate?: string; // YYYY-MM-DD
  idempotencyKey: string;
  actor: { type: 'USER' | 'SYSTEM' | 'ADMIN'; id?: string };
};

export type RequestWithdrawOutput = {
  transferRequestId: string;
  externalReference: string;
  asaasTransferId: string | null;
  status: TransferStatus;
};

export type RequestWithdrawError =
  | 'FEATURE_DISABLED'
  | 'KYC_NAO_APROVADO'
  | 'SALDO_INSUFICIENTE'
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'CREDENCIAIS_ASAAS_INVALIDAS'
  | 'PIX_KEY_NAO_ENCONTRADA'
  | 'TRANSFERENCIA_DUPLICADA'
  | 'AUTORIZACAO_CRITICA_NECESSARIA'
  | 'ERRO_AO_CRIAR_TRANSFER'
  | 'ERRO_INTERNO';

function mapWithdrawCreationError(error: unknown, destination: WithdrawDestination): RequestWithdrawError {
  if (error instanceof AsaasHttpError) {
    const failure = classifyAsaasOperationalError(error, 'subaccount');
    const detailsText = failure.details
      .map((detail) => `${detail.code ?? ''} ${detail.description ?? ''}`.trim().toLowerCase())
      .join(' ');
    const messageText = `${failure.message} ${detailsText}`.trim().toLowerCase();

    if (failure.category === 'invalid_subaccount_credentials') {
      return 'CREDENCIAIS_ASAAS_INVALIDAS';
    }

    if (error.status === 409) {
      return 'TRANSFERENCIA_DUPLICADA';
    }

    if (messageText.includes('autorização crítica habilitada') || messageText.includes('codigo de confirmação')) {
      return 'AUTORIZACAO_CRITICA_NECESSARIA';
    }

    if (destination.type === 'PIX' && messageText.includes('a chave informada não foi encontrada')) {
      return 'PIX_KEY_NAO_ENCONTRADA';
    }
  }

  return 'ERRO_AO_CRIAR_TRANSFER';
}

function toDateOrNull(dateISO?: string): Date | null {
  if (!dateISO) return null;
  const date = new Date(`${dateISO}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildCanonicalTransferExternalReference(transferRequestId: string): string {
  return `transfer:${transferRequestId}`;
}

function resolveBankAccountLabel(destination: Extract<WithdrawDestination, { type: 'BANK_ACCOUNT' }>): string {
  if (destination.accountName?.trim()) return destination.accountName.trim();
  if (destination.bankAccountType === 'CONTA_CORRENTE') return 'Conta corrente';
  if (destination.bankAccountType === 'CONTA_POUPANCA') return 'Conta poupanca';
  return 'Conta bancaria';
}

export async function requestWithdraw(
  input: RequestWithdrawInput
): Promise<Result<RequestWithdrawOutput, RequestWithdrawError>> {
  try {
    await featureFlagsService.ensureTransferFeaturesForApprovedAccount({
      contaId: input.contaId,
      actor: input.actor,
      reason: 'requestWithdraw',
    });

    const manualEnabled = await featureFlagsService.isEnabled(input.contaId, 'enableManualWithdraw');
    if (!manualEnabled) return err('FEATURE_DISABLED');

    if (input.destination.type === 'PIX') {
      const pixEnabled = await featureFlagsService.isEnabled(input.contaId, 'enablePixTransfer');
      if (!pixEnabled) return err('FEATURE_DISABLED');
    }

    if (input.destination.type === 'BANK_ACCOUNT') {
      const bankEnabled = await featureFlagsService.isEnabled(input.contaId, 'enableBankTransfer');
      if (!bankEnabled) return err('FEATURE_DISABLED');
    }

    const financeProfile = await financeProfileService.getOrCreateByTenant(input.contaId);
    const asaasAccount = await prisma.asaasAccount.findUnique({
      where: { financeProfileId: financeProfile.id },
      select: { status: true },
    });

    if (!asaasAccount) return err('KYC_NAO_APROVADO');
    if (asaasAccount.status !== 'APPROVED' && !isPendingDocumentsBlockBypassedForTesting()) {
      return err('KYC_NAO_APROVADO');
    }

    const balanceResult = await getBalance({ contaId: input.contaId });
    if (!balanceResult.success) {
      if (balanceResult.error === 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS') return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');
      return err('ERRO_INTERNO');
    }

    if (input.value <= 0 || input.value > balanceResult.data.balance) return err('SALDO_INSUFICIENTE');

    const existing = await prisma.transferRequest.findUnique({
      where: { contaId_idempotencyKey: { contaId: input.contaId, idempotencyKey: input.idempotencyKey } },
      select: { id: true, externalReference: true, asaasTransferId: true, status: true },
    });

    if (existing?.asaasTransferId) {
      return ok({
        transferRequestId: existing.id,
        externalReference: existing.externalReference,
        asaasTransferId: existing.asaasTransferId,
        status: existing.status,
      });
    }

    const scheduleDate = toDateOrNull(input.scheduleDate);

    const created = existing
      ? await prisma.transferRequest.update({
          where: { id: existing.id },
          data: {
            value: input.value,
            destination: input.destination as unknown as object,
            description: input.description,
            scheduleDate: scheduleDate ?? undefined,
          },
          select: { id: true, externalReference: true, asaasTransferId: true },
        })
      : await prisma.transferRequest.create({
          data: {
            contaId: input.contaId,
            value: input.value,
            destination: input.destination as unknown as object,
            description: input.description,
            scheduleDate: scheduleDate ?? undefined,
            idempotencyKey: input.idempotencyKey,
            externalReference: `transfer:pending:${input.idempotencyKey}`,
            status: 'REQUESTED',
          },
          select: { id: true, externalReference: true, asaasTransferId: true },
        });

    const canonicalExternalReference = buildCanonicalTransferExternalReference(created.id);
    const transferRequest =
      created.externalReference === canonicalExternalReference
        ? created
        : await prisma.transferRequest.update({
            where: { id: created.id },
            data: { externalReference: canonicalExternalReference },
            select: { id: true, externalReference: true, asaasTransferId: true },
          });

    const credentials = await loadAsaasCredentials(input.contaId);
    if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

    await ensureWebhookConfigOperational(input.contaId);

    await auditLogService.record({
      contaId: input.contaId,
      actor: input.actor,
      action: 'finance.transfer.requested',
      entity: { type: 'TransferRequest', id: transferRequest.id },
      metadata: {
        value: input.value,
        externalReference: transferRequest.externalReference,
        destinationType: input.destination.type,
        scheduleDate: input.scheduleDate,
      },
    });

    const asaasTransfer =
      input.destination.type === 'PIX'
        ? await createPixTransfer({
            apiKey: credentials.apiKey,
            idempotencyKey: input.idempotencyKey,
            data: {
              value: input.value,
              pixAddressKey: input.destination.pixAddressKey,
              pixAddressKeyType: input.destination.pixAddressKeyType,
              description: input.description,
              scheduleDate: input.scheduleDate,
              externalReference: transferRequest.externalReference,
            },
          })
        : await createBankTransfer({
            apiKey: credentials.apiKey,
            idempotencyKey: input.idempotencyKey,
            data: {
              value: input.value,
              bankAccount: {
                bank: input.destination.bank,
                accountName: resolveBankAccountLabel(input.destination),
                ownerName: input.destination.ownerName,
                ownerBirthDate: input.destination.ownerBirthDate,
                cpfCnpj: input.destination.cpfCnpj,
                agency: input.destination.agency,
                account: input.destination.account,
                accountDigit: input.destination.accountDigit,
                bankAccountType: input.destination.bankAccountType,
                ispb: input.destination.ispb,
              },
              operationType: 'TED',
              description: input.description,
              scheduleDate: input.scheduleDate,
              externalReference: transferRequest.externalReference,
            },
          });

    const mappedStatus = mapAsaasTransferStatus(asaasTransfer.status);
    if (!mappedStatus) {
      console.warn('[finance][requestWithdraw][unknown-asaas-status]', {
        contaId: input.contaId,
        asaasTransferId: asaasTransfer.id,
        rawStatus: asaasTransfer.status,
      });
    }
    let nextStatus: TransferStatus = mappedStatus ?? 'PENDING';

    // Post-creation GET confirmation
    let confirmedTransfer = asaasTransfer;
    try {
      confirmedTransfer = await asaasGetTransfer({
        apiKey: credentials.apiKey,
        id: asaasTransfer.id,
      });
      const confirmedStatus = mapAsaasTransferStatus(confirmedTransfer.status);
      if (confirmedStatus) {
        nextStatus = confirmedStatus;
      }
    } catch (error) {
      console.warn('[finance][requestWithdraw][post-creation-get-failed]', {
        contaId: input.contaId,
        asaasTransferId: asaasTransfer.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await prisma.transferRequest.update({
      where: { id: transferRequest.id },
      data: {
        asaasTransferId: confirmedTransfer.id,
        status: nextStatus,
        statusUpdatedAt: new Date(),
        rawAsaasStatus: confirmedTransfer.status,
        authorized: confirmedTransfer.authorized ?? null,
        failReason: confirmedTransfer.failReason ?? null,
        transactionReceiptUrl: confirmedTransfer.transactionReceiptUrl ?? null,
        effectiveDate: confirmedTransfer.effectiveDate ?? null,
        endToEndIdentifier: confirmedTransfer.endToEndIdentifier ?? null,
        feeValue: confirmedTransfer.transferFee ?? null,
        netValue: confirmedTransfer.netValue ?? null,
      },
    });

    await auditLogService.record({
      contaId: input.contaId,
      actor: input.actor,
      action: 'finance.transfer.created',
      entity: { type: 'TransferRequest', id: transferRequest.id },
      metadata: {
        asaasTransferId: confirmedTransfer.id,
        status: confirmedTransfer.status,
        confirmedViaGet: confirmedTransfer !== asaasTransfer,
        externalReference: transferRequest.externalReference,
      },
    });

    return ok({
      transferRequestId: transferRequest.id,
      externalReference: transferRequest.externalReference,
      asaasTransferId: confirmedTransfer.id,
      status: nextStatus,
    });
  } catch (error) {
    console.error('[finance][requestWithdraw]', error);
    return err(mapWithdrawCreationError(error, input.destination));
  }
}
