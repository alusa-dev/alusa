import { prisma, loadAsaasCredentials } from '@alusa/database';
import { getTransfer as asaasGetTransfer } from '@alusa/asaas';

import {
  extractOfficialTransferMetadata,
  extractWebhookTransferMetadata,
  mergeTransferMetadata,
  resolveOfficialFeeValue,
  resolveOfficialNetValue,
  resolveTransferMetadata,
} from './transfers/transfer-metadata';
import { resolveTransferStatus } from './transfers/transfer-status';

export type GetTransferDetailInput = {
  contaId: string;
  transferId: string;
};

export type TransferDetailRecipient = {
  name: string | null;
  cpfCnpj: string | null;
  bankName: string | null;
  pixKey: string | null;
  agency: string | null;
  account: string | null;
  accountDigit: string | null;
  accountType: string | null;
};

export type GetTransferDetailOutput = {
  id: string;
  externalReference: string;
  asaasTransferId: string | null;
  amount: number;
  feeAmount: number | null;
  netAmount: number;
  status: string;
  operation: 'PIX' | 'TED';
  description: string | null;
  scheduleDate: string | null;
  transferDate: string | null;
  createdAt: string;
  statusUpdatedAt: string | null;
  transactionReceiptUrl: string | null;
  endToEndIdentifier: string | null;
  failReason: string | null;
  authorized: boolean | null;
  recipient: TransferDetailRecipient;
};

export async function getTransferDetail(input: GetTransferDetailInput): Promise<GetTransferDetailOutput> {
  const transfer = await prisma.transferRequest.findFirst({
    where: {
      id: input.transferId,
      contaId: input.contaId,
    },
    select: {
      id: true,
      externalReference: true,
      asaasTransferId: true,
      value: true,
      feeValue: true,
      netValue: true,
      endToEndIdentifier: true,
      destination: true,
      description: true,
      scheduleDate: true,
      status: true,
      statusUpdatedAt: true,
      createdAt: true,
      pixTransferSession: {
        select: {
          recipientName: true,
          recipientDocumentMasked: true,
          recipientBank: true,
          recipientPixKeyMasked: true,
        },
      },
    },
  });

  if (!transfer) {
    throw new Error('TRANSFER_NAO_ENCONTRADA');
  }

  const webhook = transfer.asaasTransferId
    ? await prisma.webhookAsaas.findFirst({
        where: {
          contaId: input.contaId,
          asaasTransferId: transfer.asaasTransferId,
        },
        orderBy: { recebidoEm: 'desc' },
        select: { payload: true },
      })
    : null;

  let officialTransfer: Awaited<ReturnType<typeof asaasGetTransfer>> | null = null;
  if (transfer.asaasTransferId) {
    const credentials = await loadAsaasCredentials(input.contaId);
    if (credentials?.apiKey) {
      try {
        officialTransfer = await asaasGetTransfer({
          apiKey: credentials.apiKey,
          id: transfer.asaasTransferId,
        });
      } catch (error) {
        console.warn('[finance][getTransferDetail][official-transfer]', {
          contaId: input.contaId,
          transferId: transfer.id,
          asaasTransferId: transfer.asaasTransferId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const baseMetadata = resolveTransferMetadata(transfer.destination, transfer.description ?? null);
  const sessionMetadata = transfer.pixTransferSession
    ? {
        recipientName: transfer.pixTransferSession.recipientName ?? null,
        cpfCnpjMasked: transfer.pixTransferSession.recipientDocumentMasked ?? null,
        bankName: transfer.pixTransferSession.recipientBank ?? null,
        pixKeyMasked: transfer.pixTransferSession.recipientPixKeyMasked ?? null,
      }
    : null;
  const webhookMetadata = extractWebhookTransferMetadata(webhook?.payload ?? null);
  const officialMetadata = extractOfficialTransferMetadata(officialTransfer);
  const metadata = mergeTransferMetadata(baseMetadata, sessionMetadata, webhookMetadata, officialMetadata);
  const amount = officialTransfer?.value ?? Number(transfer.value);

  return {
    id: transfer.id,
    externalReference: officialTransfer?.externalReference ?? transfer.externalReference,
    asaasTransferId: transfer.asaasTransferId ?? officialTransfer?.id ?? null,
    amount,
    feeAmount: resolveOfficialFeeValue(officialTransfer, webhookMetadata, amount) ?? (transfer.feeValue !== null ? Number(transfer.feeValue) : null),
    netAmount: resolveOfficialNetValue(officialTransfer, webhookMetadata, amount) ?? (transfer.netValue !== null ? Number(transfer.netValue) : amount),
    status: resolveTransferStatus({ asaasStatus: officialTransfer?.status }) ?? transfer.status,
    operation: metadata.operation,
    description: officialTransfer?.description?.trim() || transfer.description || null,
    scheduleDate: officialTransfer?.scheduleDate ?? transfer.scheduleDate?.toISOString() ?? null,
    transferDate: officialTransfer?.effectiveDate ?? transfer.statusUpdatedAt?.toISOString() ?? null,
    createdAt: transfer.createdAt.toISOString(),
    statusUpdatedAt: transfer.statusUpdatedAt?.toISOString() ?? null,
    transactionReceiptUrl: officialTransfer?.transactionReceiptUrl ?? null,
    endToEndIdentifier: officialTransfer?.endToEndIdentifier ?? transfer.endToEndIdentifier ?? null,
    failReason: officialTransfer?.failReason?.trim() ?? null,
    authorized: typeof officialTransfer?.authorized === 'boolean' ? officialTransfer.authorized : null,
    recipient: {
      name: metadata.recipientName,
      cpfCnpj: metadata.cpfCnpjMasked,
      bankName: metadata.bankName,
      pixKey: metadata.pixKeyMasked,
      agency: metadata.agency,
      account: metadata.account,
      accountDigit: metadata.accountDigit,
      accountType: metadata.accountType,
    },
  };
}