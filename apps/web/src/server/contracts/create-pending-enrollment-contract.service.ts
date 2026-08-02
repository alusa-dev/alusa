import type { Prisma } from '@prisma/client';
import { createContractEvidence, createPublicContractToken } from '@alusa/lib';

export class EnrollmentContractModelNotFoundError extends Error {
  constructor() {
    super('Modelo de contrato ativo não encontrado nesta conta.');
    this.name = 'EnrollmentContractModelNotFoundError';
  }
}

export async function createPendingEnrollmentContract(
  tx: Prisma.TransactionClient,
  input: {
    contaId: string;
    matriculaId: string;
    modeloId: string;
    actorId: string;
  },
) {
  const modelo = await tx.contratoModelo.findFirst({
    where: {
      id: input.modeloId,
      contaId: input.contaId,
      status: 'ATIVO',
    },
  });

  if (!modelo) {
    throw new EnrollmentContractModelNotFoundError();
  }

  const existing = await tx.contrato.findFirst({
    where: {
      contaId: input.contaId,
      matriculaId: input.matriculaId,
      status: 'PENDENTE',
    },
    select: { id: true },
  });

  if (existing) {
    await tx.matricula.updateMany({
      where: { id: input.matriculaId, contaId: input.contaId },
      data: {
        contratoAtualId: existing.id,
        statusContrato: 'AGUARDANDO_ASSINATURA',
      },
    });
    return existing;
  }

  const { tokenHash } = createPublicContractToken();
  const tokenExpiraEm = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const contrato = await tx.contrato.create({
    data: {
      contaId: input.contaId,
      matriculaId: input.matriculaId,
      modeloId: input.modeloId,
      arquivoPdfUrl: modelo.arquivoPdfUrl,
      hashPdf: modelo.hashSha256,
      status: 'PENDENTE',
      tokenPublico: `hash:${tokenHash}`,
      tokenPublicoHash: tokenHash,
      tokenExpiraEm,
    },
  });

  await tx.contratoDocumento.create({
    data: {
      contaId: input.contaId,
      contratoId: contrato.id,
      tipo: 'GERADO_MATRICULA',
      arquivoUrl: modelo.arquivoPdfUrl,
      hashSha256: modelo.hashSha256,
      tamanhoBytes: modelo.tamanhoBytes ?? null,
      mimeType: modelo.mimeType,
    },
  });

  if (modelo.arquivoOriginalUrl) {
    await tx.contratoDocumento.create({
      data: {
        contaId: input.contaId,
        contratoId: contrato.id,
        tipo: 'MODELO_ORIGINAL',
        arquivoUrl: modelo.arquivoOriginalUrl,
        hashSha256: modelo.hashSha256,
        tamanhoBytes: modelo.tamanhoBytes ?? null,
        mimeType: modelo.mimeType,
      },
    });
  }

  await createContractEvidence(tx, {
    contaId: input.contaId,
    contratoId: contrato.id,
    type: 'CONTRACT_CREATED',
    actorType: 'USER',
    actorId: input.actorId,
    payload: {
      matriculaId: input.matriculaId,
      modeloId: input.modeloId,
      hashPdf: modelo.hashSha256,
      source: 'ENROLLMENT_TRANSACTION',
    },
  });
  await createContractEvidence(tx, {
    contaId: input.contaId,
    contratoId: contrato.id,
    type: 'PUBLIC_LINK_CREATED',
    actorType: 'USER',
    actorId: input.actorId,
    payload: {
      tokenPublicoHash: tokenHash,
      tokenExpiraEm: tokenExpiraEm.toISOString(),
    },
  });

  await tx.matricula.updateMany({
    where: { id: input.matriculaId, contaId: input.contaId },
    data: {
      contratoAtualId: contrato.id,
      statusContrato: 'AGUARDANDO_ASSINATURA',
    },
  });

  return contrato;
}
