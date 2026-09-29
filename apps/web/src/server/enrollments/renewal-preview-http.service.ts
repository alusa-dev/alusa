import { prisma } from '@/src/prisma';
import { previewRenewalProcess, type RenewalProcessInput } from './renewal-process.service';

export async function validateRenewalPreviewReferences(input: {
  contaId: string;
  responsavelId: string;
  novoResponsavelId?: string | null;
  campaignId?: string | null;
  targetPeriodId: string;
}) {
  const responsavel = await prisma.responsavel.findFirst({ where: { id: input.responsavelId, contaId: input.contaId }, select: { id: true } });
  if (!responsavel) return { ok: false as const, code: 'RESPONSAVEL_NAO_ENCONTRADO', message: 'Responsável não encontrado.' };
  if (input.novoResponsavelId) {
    const novo = await prisma.responsavel.findFirst({ where: { id: input.novoResponsavelId, contaId: input.contaId }, select: { id: true } });
    if (!novo) return { ok: false as const, code: 'NOVO_RESPONSAVEL_NAO_ENCONTRADO', message: 'Novo responsável não encontrado.' };
  }
  if (input.campaignId) {
    const campaign = await prisma.rematriculaCampanha.findFirst({ where: { id: input.campaignId, contaId: input.contaId, targetPeriodId: input.targetPeriodId }, select: { id: true } });
    if (!campaign) return { ok: false as const, code: 'CAMPANHA_NAO_ENCONTRADA', message: 'Campanha não encontrada para este período.' };
  }
  return { ok: true as const };
}

export async function previewRenewalProcessForTenant(input: RenewalProcessInput) {
  return previewRenewalProcess(input, { prisma });
}

export async function getRenewalPreviewStudentNames(input: { contaId: string; matriculaIds: string[] }) {
  const sourceStudents = await prisma.matricula.findMany({ where: { contaId: input.contaId, id: { in: input.matriculaIds } }, select: { id: true, aluno: { select: { nome: true } } } });
  return new Map(sourceStudents.map((item) => [item.id, item.aluno.nome]));
}
