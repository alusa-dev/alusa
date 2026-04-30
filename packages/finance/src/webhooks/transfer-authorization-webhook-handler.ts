import { createHash } from 'node:crypto';

import { prisma } from '@alusa/database';

import { auditLogService } from '../foundation/audit-log.service';

export type TransferAuthorizationWebhookPayload = {
  type?: string;
  transfer?: {
    id: string;
    status?: string;
    externalReference?: string | null;
    description?: string | null;
    bankAccount?: {
      ownerName?: string | null;
      cpfCnpj?: string | null;
      pixAddressKey?: string | null;
      bank?: {
        name?: string | null;
      } | null;
    } | null;
  } | null;
};

export type TransferAuthorizationDecision =
  | { status: 'APPROVED' }
  | { status: 'REFUSED'; refuseReason: string };

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function buildAttemptsLog(decision: TransferAuthorizationDecision, duracaoMs: number) {
  return [
    {
      at: new Date().toISOString(),
      ok: true,
      status: 'PROCESSADO',
      source: 'WEBHOOK',
      duracaoMs,
      decision,
    },
  ];
}

function extractPersistedDecision(payload: unknown): TransferAuthorizationDecision | null {
  if (!payload || typeof payload !== 'object') return null;

  const decision = (payload as { authorizationDecision?: unknown }).authorizationDecision;
  if (!decision || typeof decision !== 'object') return null;

  if ((decision as { status?: string }).status === 'APPROVED') {
    return { status: 'APPROVED' };
  }

  if ((decision as { status?: string }).status === 'REFUSED') {
    return {
      status: 'REFUSED',
      refuseReason: String((decision as { refuseReason?: string }).refuseReason ?? 'Transferencia recusada'),
    };
  }

  return null;
}

async function persistDecision(params: {
  contaId: string;
  rawBody: string;
  payload: TransferAuthorizationWebhookPayload;
  decision: TransferAuthorizationDecision;
  duracaoMs: number;
}) {
  const payloadHash = sha256Hex(params.rawBody);

  const existing = await prisma.webhookAsaas.findFirst({
    where: {
      contaId: params.contaId,
      payloadHash,
    },
    select: { id: true },
  });

  if (!existing) {
    await prisma.webhookAsaas.create({
      data: {
        contaId: params.contaId,
        evento: 'TRANSFER_AUTHORIZATION',
        payloadHash,
        payload: {
          request: params.payload,
          authorizationDecision: params.decision,
        },
        asaasTransferId: params.payload.transfer?.id ?? null,
        status: 'PROCESSADO',
        processadoEm: new Date(),
        tentativas: 1,
        ultimaTentativaEm: new Date(),
        duracaoMs: params.duracaoMs,
        attemptsLog: buildAttemptsLog(params.decision, params.duracaoMs),
      },
    });
    return;
  }

  await prisma.webhookAsaas.update({
    where: { id: existing.id },
    data: {
      payload: {
        request: params.payload,
        authorizationDecision: params.decision,
      },
      asaasTransferId: params.payload.transfer?.id ?? null,
      status: 'PROCESSADO',
      processadoEm: new Date(),
      tentativas: { increment: 1 },
      ultimaTentativaEm: new Date(),
      duracaoMs: params.duracaoMs,
      attemptsLog: buildAttemptsLog(params.decision, params.duracaoMs),
      ultimoErro: null,
    },
  });
}

export async function handleTransferAuthorizationWebhook(params: {
  contaId: string;
  rawBody: string;
  payload: TransferAuthorizationWebhookPayload;
}): Promise<TransferAuthorizationDecision> {
  const startedAt = Date.now();
  const transfer = params.payload.transfer;

  if (!transfer?.id) {
    return { status: 'REFUSED', refuseReason: 'Transferencia nao reconhecida' };
  }

  const payloadHash = sha256Hex(params.rawBody);
  const existing = await prisma.webhookAsaas.findFirst({
    where: {
      contaId: params.contaId,
      payloadHash,
    },
    select: { payload: true },
  });

  const previousDecision = extractPersistedDecision(existing?.payload);
  if (previousDecision) return previousDecision;

  const externalReference = transfer.externalReference ?? null;
  let decision: TransferAuthorizationDecision;

  const transferRequest = await prisma.transferRequest.findFirst({
    where: {
      contaId: params.contaId,
      OR: [
        { asaasTransferId: transfer.id },
        ...(externalReference ? [{ externalReference }] : []),
      ],
    },
    select: {
      id: true,
      externalReference: true,
      asaasTransferId: true,
    },
  });

  if (!transferRequest) {
    decision = { status: 'REFUSED', refuseReason: 'Transferencia nao encontrada' };
  } else {
    if (!transferRequest.asaasTransferId) {
      await prisma.transferRequest.update({
        where: { id: transferRequest.id },
        data: { asaasTransferId: transfer.id },
      });
    }

    await auditLogService.record({
      contaId: params.contaId,
      action: 'finance.transfer.authorization_approved',
      entity: { type: 'TransferRequest', id: transferRequest.id },
      metadata: {
        asaasTransferId: transfer.id,
        externalReference: transferRequest.externalReference,
      },
    });

    decision = { status: 'APPROVED' };
  }

  await persistDecision({
    contaId: params.contaId,
    rawBody: params.rawBody,
    payload: params.payload,
    decision,
    duracaoMs: Date.now() - startedAt,
  });

  return decision;
}