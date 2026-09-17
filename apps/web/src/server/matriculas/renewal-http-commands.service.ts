import { prisma } from '@/src/prisma';
import {
  activateRenewalCampaign,
  createRenewalCampaign,
  deleteRenewalCampaign,
  getRenewalCampaignOverview,
  getRenewalProcessDetail,
  listRenewalManagement,
  updateRenewalCampaign,
} from './renewal-management.service';
import { resolveRenewalPending } from './renewal-governance.service';
import {
  cancelRenewalProcess,
  confirmRenewalProcess,
  editRenewalFutureLink,
  previewRenewalProcess,
} from './renewal-process.service';

type WithoutDeps<T> = T extends (..._args: infer Args) => unknown
  ? Args extends [infer Input, ...unknown[]]
    ? Input
    : never
  : never;

export function listRenewalManagementFromHttp(input: WithoutDeps<typeof listRenewalManagement>) {
  return listRenewalManagement(input, { prisma });
}

export function createRenewalCampaignFromHttp(input: WithoutDeps<typeof createRenewalCampaign>) {
  return createRenewalCampaign(input, { prisma });
}

export function updateRenewalCampaignFromHttp(input: WithoutDeps<typeof updateRenewalCampaign>) {
  return updateRenewalCampaign(input, { prisma });
}

export function deleteRenewalCampaignFromHttp(input: WithoutDeps<typeof deleteRenewalCampaign>) {
  return deleteRenewalCampaign(input, { prisma });
}

export function activateRenewalCampaignFromHttp(input: WithoutDeps<typeof activateRenewalCampaign>) {
  return activateRenewalCampaign(input, { prisma });
}

export function getRenewalCampaignOverviewFromHttp(input: WithoutDeps<typeof getRenewalCampaignOverview>) {
  return getRenewalCampaignOverview(input, { prisma });
}

export function getRenewalProcessDetailFromHttp(input: WithoutDeps<typeof getRenewalProcessDetail>) {
  return getRenewalProcessDetail(input, { prisma });
}

export function resolveRenewalPendingFromHttp(input: WithoutDeps<typeof resolveRenewalPending>) {
  return resolveRenewalPending(input, { prisma });
}

export function previewRenewalProcessFromHttp(input: WithoutDeps<typeof previewRenewalProcess>) {
  return previewRenewalProcess(input, { prisma });
}

export function confirmRenewalProcessFromHttp(input: WithoutDeps<typeof confirmRenewalProcess>) {
  return confirmRenewalProcess(input, { prisma });
}

export function cancelRenewalProcessFromHttp(input: WithoutDeps<typeof cancelRenewalProcess>) {
  return cancelRenewalProcess(input, { prisma });
}

export function editRenewalFutureLinkFromHttp(input: WithoutDeps<typeof editRenewalFutureLink>) {
  return editRenewalFutureLink(input, { prisma });
}

export async function validateFamilyRenewalReferences(input: {
  contaId: string;
  responsavelId: string;
  novoResponsavelId?: string | null;
  contratoModeloId?: string | null;
  campaignId?: string | null;
  targetPeriodId: string;
}) {
  const [responsavel, novoResponsavel, modelo, campaign] = await Promise.all([
    prisma.responsavel.findFirst({
      where: { id: input.responsavelId, contaId: input.contaId },
      select: { id: true },
    }),
    input.novoResponsavelId
      ? prisma.responsavel.findFirst({
          where: { id: input.novoResponsavelId, contaId: input.contaId },
          select: { id: true },
        })
      : Promise.resolve(null),
    input.contratoModeloId
      ? prisma.contratoModelo.findFirst({
          where: { id: input.contratoModeloId, contaId: input.contaId, status: 'ATIVO' },
          select: { id: true },
        })
      : Promise.resolve(null),
    input.campaignId
      ? prisma.rematriculaCampanha.findFirst({
          where: { id: input.campaignId, contaId: input.contaId, targetPeriodId: input.targetPeriodId },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  return { responsavel, novoResponsavel, modelo, campaign };
}

export function listConfirmedRenewalItems(input: { contaId: string; processId: string }) {
  return prisma.rematriculaItem.findMany({
    where: { contaId: input.contaId, processoId: input.processId },
    include: {
      matriculaOrigem: { select: { alunoId: true, aluno: { select: { nome: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  });
}
