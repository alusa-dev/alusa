import { validateEnrollmentTransfer } from '@alusa/domain';
import { Prisma } from '@prisma/client';

export class AcademicTransferError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'AcademicTransferError';
  }
}

type TransferTx = Prisma.TransactionClient;

export async function registerPendingAcademicTransfer(input: {
  tx: TransferTx;
  contaId: string;
  sourceLinkId: string;
  destinationLinkId: string;
  reason: string;
  actorId: string;
}) {
  const [source, destination] = await Promise.all([
    input.tx.matriculaVinculoAcademico.findFirst({
      where: { id: input.sourceLinkId, contaId: input.contaId },
      select: { id: true, modalidadeId: true, vigenciaIniciadaEm: true, matricula: { select: { alunoId: true } } },
    }),
    input.tx.matriculaVinculoAcademico.findFirst({
      where: { id: input.destinationLinkId, contaId: input.contaId },
      select: { id: true, modalidadeId: true, classificacao: true, matricula: { select: { alunoId: true } } },
    }),
  ]);
  if (!source || !destination) throw new AcademicTransferError('VINCULO_NAO_ENCONTRADO', 'Vínculo acadêmico não encontrado.', 404);
  if (source.matricula.alunoId !== destination.matricula.alunoId) {
    throw new AcademicTransferError('TRANSFERENCIA_ORIGEM_INVALIDA', 'A origem e o destino devem pertencer ao mesmo aluno.', 409);
  }
  if (!source.vigenciaIniciadaEm) {
    throw new AcademicTransferError('TRANSFERENCIA_ORIGEM_INVALIDA', 'A origem precisa ter entrado em vigência para ser usada como evidência acadêmica.', 409);
  }
  if (source.modalidadeId === destination.modalidadeId) {
    throw new AcademicTransferError('TRANSFERENCIA_ORIGEM_INVALIDA', 'A transferência deve apontar para outro curso.', 409);
  }

  const [sourceUse, destinationUse] = await Promise.all([
    input.tx.transferenciaAcademicaVinculo.findFirst({
      where: { contaId: input.contaId, origemVinculoId: source.id },
      select: { id: true },
    }),
    input.tx.transferenciaAcademicaVinculo.findFirst({
      where: { contaId: input.contaId, destinoVinculoId: destination.id },
      select: { id: true, status: true, origemVinculoId: true },
    }),
  ]);
  if (sourceUse || destinationUse) {
    throw new AcademicTransferError('TRANSFERENCIA_JA_REGISTRADA', 'Já existe uma operação de transferência para um destes vínculos.', 409);
  }

  const relation = await input.tx.transferenciaAcademicaVinculo.create({
    data: {
      contaId: input.contaId,
      origemVinculoId: source.id,
      destinoVinculoId: destination.id,
      status: 'PENDENTE',
      motivo: input.reason,
      solicitadaPor: input.actorId,
    },
  });
  const destinationUpdate = await input.tx.matriculaVinculoAcademico.updateMany({
    where: { id: destination.id, contaId: input.contaId, classificacao: destination.classificacao },
    data: {
      classificacao: 'HISTORICO_INDETERMINADO',
      classificacaoOrigem: 'MANUAL_ADMIN',
      classificacaoMotivo: 'TRANSFERENCIA_PENDENTE',
      classificacaoDefinidaEm: new Date(),
    },
  });
  if (destinationUpdate.count !== 1) {
    throw new AcademicTransferError('CLASSIFICACAO_ALTERADA', 'A classificação do vínculo mudou durante o registro da transferência pendente.', 409);
  }
  await input.tx.matriculaClassificacaoAudit.create({
    data: {
      contaId: input.contaId,
      vinculoAcademicoId: destination.id,
      de: destination.classificacao,
      para: 'HISTORICO_INDETERMINADO',
      motivo: input.reason,
      autorId: input.actorId,
    },
  });
  return relation;
}

export async function formalizePendingAcademicTransfer(input: {
  tx: TransferTx;
  contaId: string;
  destinationLinkId: string;
  actorId: string;
}) {
  const relation = await input.tx.transferenciaAcademicaVinculo.findFirst({
    where: { contaId: input.contaId, destinoVinculoId: input.destinationLinkId },
    select: { id: true, origemVinculoId: true, destinoVinculoId: true, motivo: true, status: true },
  });
  if (!relation) throw new AcademicTransferError('TRANSFERENCIA_NAO_ENCONTRADA', 'Transferência pendente não encontrada.', 404);
  if (relation.status !== 'PENDENTE') throw new AcademicTransferError('TRANSFERENCIA_JA_FORMALIZADA', 'A transferência já foi formalizada.', 409);

  const [source, destination, otherSourceUse] = await Promise.all([
    input.tx.matriculaVinculoAcademico.findFirst({
      where: { id: relation.origemVinculoId, contaId: input.contaId },
      select: { id: true, modalidadeId: true, vigenciaIniciadaEm: true, matricula: { select: { alunoId: true } } },
    }),
    input.tx.matriculaVinculoAcademico.findFirst({
      where: { id: relation.destinoVinculoId, contaId: input.contaId },
      select: { id: true, modalidadeId: true, cicloAcademicoId: true, classificacao: true, matricula: { select: { alunoId: true } } },
    }),
    input.tx.transferenciaAcademicaVinculo.findFirst({
      where: { contaId: input.contaId, origemVinculoId: relation.origemVinculoId, id: { not: relation.id } },
      select: { id: true },
    }),
  ]);
  if (!source || !destination) throw new AcademicTransferError('VINCULO_NAO_ENCONTRADO', 'Vínculo acadêmico não encontrado.', 404);
  const validation = validateEnrollmentTransfer({
    sourceFound: true,
    sourceStudentId: source.matricula.alunoId,
    expectedStudentId: destination.matricula.alunoId,
    sourceCourseId: source.modalidadeId,
    destinationCourseIds: [destination.modalidadeId],
    sourceEffective: source.vigenciaIniciadaEm != null,
    alreadyTransferred: otherSourceUse != null,
  });
  if (!validation.valid) {
    throw new AcademicTransferError('TRANSFERENCIA_ORIGEM_INVALIDA', `A transferência não pode ser formalizada: ${validation.error}.`, 409);
  }
  if (destination.classificacao !== 'HISTORICO_INDETERMINADO') {
    throw new AcademicTransferError('CLASSIFICACAO_ALTERADA', 'A classificação do vínculo mudou após o registro da transferência pendente.', 409);
  }

  const now = new Date();
  const relationUpdate = await input.tx.transferenciaAcademicaVinculo.updateMany({
    where: { id: relation.id, contaId: input.contaId, status: 'PENDENTE' },
    data: { status: 'FORMALIZADA', formalizadaEm: now, formalizadaPor: input.actorId },
  });
  if (relationUpdate.count !== 1) throw new AcademicTransferError('TRANSFERENCIA_CONCORRENTE', 'A transferência foi alterada por outra operação.', 409);
  const linkUpdate = await input.tx.matriculaVinculoAcademico.updateMany({
    where: { id: destination.id, contaId: input.contaId, classificacao: 'HISTORICO_INDETERMINADO' },
    data: {
      classificacao: 'TRANSFERENCIA',
      classificacaoOrigem: 'TRANSFERENCIA_FORMAL',
      classificacaoMotivo: 'TRANSFER_FORMALIZADA',
      classificacaoDefinidaEm: now,
    },
  });
  if (linkUpdate.count !== 1) throw new AcademicTransferError('CLASSIFICACAO_ALTERADA', 'A classificação do vínculo mudou durante a formalização.', 409);
  await input.tx.matriculaClassificacaoAudit.create({
    data: {
      contaId: input.contaId,
      vinculoAcademicoId: destination.id,
      de: 'HISTORICO_INDETERMINADO',
      para: 'TRANSFERENCIA',
      motivo: relation.motivo,
      autorId: input.actorId,
    },
  });
  return { ...relation, status: 'FORMALIZADA' as const, formalizadaEm: now, formalizadaPor: input.actorId };
}
