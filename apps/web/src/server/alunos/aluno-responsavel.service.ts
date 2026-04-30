import { prisma } from '@/prisma/client';

export type VinculoAlunoResponsavelInput = {
  contaId: string;
  alunoId: string;
  responsavelId: string;
  tipoVinculo: string;
};

export type VinculoAlunoResponsavelResult = {
  id: string;
  alunoId: string;
  responsavelId: string;
  tipoVinculo: string;
};

export type VinculoAlunoResponsavelOutcome = {
  vinculo: VinculoAlunoResponsavelResult;
  created: boolean;
};

export type VinculoAlunoResponsavelErrorCode =
  | 'ALUNO_NOT_FOUND'
  | 'RESPONSAVEL_NOT_FOUND';

export class VinculoAlunoResponsavelError extends Error {
  constructor(public readonly code: VinculoAlunoResponsavelErrorCode, message: string) {
    super(message);
    this.name = 'VinculoAlunoResponsavelError';
  }
}

export async function vincularResponsavelAoAluno(
  input: VinculoAlunoResponsavelInput,
): Promise<VinculoAlunoResponsavelOutcome> {
  return prisma.$transaction(async (tx) => {
    const aluno = await tx.aluno.findFirst({
      where: { id: input.alunoId, contaId: input.contaId },
      select: { id: true },
    });

    if (!aluno) {
      throw new VinculoAlunoResponsavelError('ALUNO_NOT_FOUND', 'Aluno não encontrado.');
    }

    // Multi-tenant: busca responsável diretamente por contaId
    const responsavel = await tx.responsavel.findFirst({
      where: { id: input.responsavelId, contaId: input.contaId },
      select: { id: true },
    });

    if (!responsavel) {
      throw new VinculoAlunoResponsavelError(
        'RESPONSAVEL_NOT_FOUND',
        'Responsável não encontrado nesta conta.',
      );
    }

    const existing = await tx.alunoResponsavel.findFirst({
      where: { alunoId: input.alunoId, responsavelId: input.responsavelId },
      select: { id: true, alunoId: true, responsavelId: true, tipoVinculo: true },
    });

    if (existing) {
      return { vinculo: existing, created: false };
    }

    const vinculo = await tx.alunoResponsavel.create({
      data: {
        alunoId: input.alunoId,
        responsavelId: input.responsavelId,
        tipoVinculo: input.tipoVinculo,
      },
      select: { id: true, alunoId: true, responsavelId: true, tipoVinculo: true },
    });

    return { vinculo, created: true };
  });
}