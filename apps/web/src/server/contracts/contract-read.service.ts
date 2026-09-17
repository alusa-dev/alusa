import { prisma } from '@/prisma/client';
import { StatusAssinatura, type Prisma } from '@prisma/client';
import { canCancelContract } from '@alusa/domain';
import { createContractEvidence } from '@alusa/lib/contracts/evidence/create-contract-evidence';
import { createContractCancelledNotification } from '@alusa/lib/notifications/domain-notifications';
import { createPublicContractToken, hashPublicContractToken } from '@alusa/lib/contracts/tokens';
import { encryptSecret } from '@alusa/database';
import { normalizeBrazilianWhatsAppPhone } from '@alusa/whatsapp';
import { getWhatsAppRuntimeConfig } from '@/src/server/whatsapp/config';

const contractListInclude = {
  modelo: { select: { id: true, nome: true } },
  matricula: {
    select: {
      id: true,
      contratoAtualId: true,
      aluno: { select: { id: true, nome: true, cpf: true } },
      turma: { select: { id: true, nome: true } },
    },
  },
} as const;

/**
 * Loads the intentionally small public contract projection. Public routes use
 * this app-owned adapter so their persistence boundary remains injectable in
 * tests and continues to use the web app's canonical Prisma client.
 */
export function findPublicContractByToken(token: string) {
  const tokenHash = hashPublicContractToken(token);
  return prisma.contrato.findFirst({
    where: {
      OR: [
        { tokenPublicoHash: tokenHash },
        { tokenPublicoHash: null, tokenPublico: token },
      ],
    },
    select: {
      id: true,
      contaId: true,
      arquivoPdfUrl: true,
      hashPdf: true,
      camposAssinaturaSnapshot: true,
      termosConsentimentoSnapshot: true,
      status: true,
      tokenExpiraEm: true,
      conta: { select: { nome: true } },
      matricula: {
        select: {
          aluno: {
            select: {
              nome: true,
              dataNasc: true,
              responsaveis: {
                where: {},
                orderBy: { id: 'asc' },
                take: 1,
                select: { responsavel: { select: { nome: true } } },
              },
            },
          },
          responsavelFinanceiro: { select: { nome: true } },
        },
      },
      modelo: {
        select: {
          campos: { orderBy: { ordem: 'asc' } },
          consentimentos: { orderBy: { ordem: 'asc' } },
        },
      },
    },
  });
}

export async function getContractForTenant(input: { contaId: string; id: string }) {
  return prisma.contrato.findFirst({
    where: { id: input.id, contaId: input.contaId, matricula: { contaId: input.contaId } },
    include: contractListInclude,
  });
}

export async function getContractForRegeneration(input: { contaId: string; id: string }) {
  return prisma.contrato.findFirst({
    where: { id: input.id, contaId: input.contaId, matricula: { contaId: input.contaId } },
    include: {
      matricula: {
        select: {
          id: true,
          aluno: {
            select: {
              dataNasc: true,
              telefone: true,
              responsaveis: {
                where: { contaId: input.contaId, tipoVinculo: { in: ['FINANCEIRO', 'PRINCIPAL'] } },
                orderBy: { id: 'asc' }, take: 1,
                select: { responsavel: { select: { telefone: true } } },
              },
            },
          },
          responsavelFinanceiro: { select: { telefone: true } },
        },
      },
    },
  });
}

export async function regenerateContractLinkForTenant(input: { contaId: string; contractId: string; actorId: string }) {
  const contrato = await getContractForRegeneration({ contaId: input.contaId, id: input.contractId });
  if (!contrato) return { status: 'NOT_FOUND' as const };
  if (!['PENDENTE', 'RECUSADO', 'EXPIRADO'].includes(contrato.status)) return { status: 'NOT_REGENERATABLE' as const };
  const novaExpiracao = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const { token: tokenPublico, tokenHash: tokenPublicoHash } = createPublicContractToken();
  await prisma.$transaction(async (tx) => {
    const updated = await tx.contrato.updateMany({ where: { id: contrato.id, contaId: input.contaId, status: contrato.status }, data: { tokenPublico: `hash:${tokenPublicoHash}`, tokenPublicoHash, tokenPublicoCriptografado: encryptSecret(tokenPublico), tokenExpiraEm: novaExpiracao, status: 'PENDENTE' } });
    if (updated.count !== 1) throw new Error('CONTRACT_CHANGED_CONCURRENTLY');
    await createContractEvidence(tx as never, { contaId: input.contaId, contratoId: contrato.id, type: 'PUBLIC_LINK_CREATED', actorType: 'USER', actorId: input.actorId, payload: { tokenPublicoHash, tokenExpiraEm: novaExpiracao.toISOString(), regenerated: true } });
    await tx.matricula.updateMany({ where: { id: contrato.matricula.id, contaId: input.contaId }, data: { contratoAtualId: contrato.id, statusContrato: 'AGUARDANDO_ASSINATURA' } });
    const alunoMaior = isAdult(contrato.matricula.aluno.dataNasc);
    const recipientPhone = alunoMaior ? contrato.matricula.aluno.telefone : contrato.matricula.responsavelFinanceiro?.telefone ?? contrato.matricula.aluno.responsaveis[0]?.responsavel.telefone ?? null;
    if (!recipientPhone) return;
    let normalized = '';
    try { normalized = normalizeBrazilianWhatsAppPhone(recipientPhone); } catch { normalized = ''; }
    if (!normalized) return;
    const config = getWhatsAppRuntimeConfig();
    await tx.contractWhatsAppNotification.upsert({
      where: { uq_contract_whatsapp_notification_dedupe: { contaId: input.contaId, contratoId: contrato.id, recipientPhone: normalized, templateName: alunoMaior ? config.contractMajorTemplateName : config.contractMinorTemplateName } },
      update: { tokenCriptografado: encryptSecret(tokenPublico), status: 'PENDING', nextAttemptAt: new Date(), lockedAt: null, lockedBy: null, processedAt: null, lastErrorCode: null, lastError: null },
      create: { contaId: input.contaId, contratoId: contrato.id, matriculaId: contrato.matricula.id, templateName: alunoMaior ? config.contractMajorTemplateName : config.contractMinorTemplateName, languageCode: config.contractTemplateLanguage, recipientPhone: normalized, recipientType: alunoMaior ? 'ALUNO' : 'RESPONSAVEL', tokenCriptografado: encryptSecret(tokenPublico), correlationId: `contract:${contrato.id}:regenerated` },
    });
  });
  const hydrated = await getContractForTenant({ contaId: input.contaId, id: contrato.id });
  if (!hydrated) return { status: 'NOT_FOUND_AFTER_REGENERATION' as const };
  return { status: 'REGENERATED' as const, tokenPublico, contrato: hydrated };
}

function isAdult(value: Date) {
  const now = new Date();
  const birth = new Date(value);
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  if (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age >= 18;
}

export async function listContractsForTenant(input: {
  contaId: string;
  matriculaId?: string;
  alunoId?: string;
  status?: StatusAssinatura;
}) {
  return prisma.contrato.findMany({
    where: {
      contaId: input.contaId,
      matricula: {
        contaId: input.contaId,
        ...(input.alunoId ? { aluno: { contaId: input.contaId, id: input.alunoId } } : {}),
        ...(input.matriculaId ? { id: input.matriculaId } : {}),
      },
      ...(input.status ? { status: input.status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: contractListInclude,
  });
}

export async function cancelContractForTenant(input: {
  contaId: string;
  contractId: string;
  actorId: string;
}) {
  const contrato = await prisma.contrato.findFirst({
    where: { id: input.contractId, contaId: input.contaId, matricula: { contaId: input.contaId } },
    include: { matricula: { select: { contratoAtualId: true, id: true, aluno: { select: { nome: true } } } } },
  });
  if (!contrato) return { status: 'NOT_FOUND' as const };
  if (!canCancelContract(contrato.status)) return { status: 'NOT_CANCELLABLE' as const };

  const cancelled = await prisma.$transaction(async (tx) => {
    const result = await tx.contrato.updateMany({
      where: { id: input.contractId, contaId: input.contaId, status: contrato.status },
      data: { status: 'CANCELADO' },
    });
    if (result.count !== 1) return false;
    await createContractEvidence(tx as never, {
      contaId: input.contaId,
      contratoId: contrato.id,
      type: 'CONTRACT_CANCELLED',
      actorType: 'USER',
      actorId: input.actorId,
      payload: { matriculaId: contrato.matricula.id, previousStatus: contrato.status },
    }).catch(() => undefined);
    if (contrato.matricula.contratoAtualId === contrato.id) {
      await tx.matricula.updateMany({
        where: { id: contrato.matricula.id, contaId: input.contaId, contratoAtualId: contrato.id },
        data: { statusContrato: 'CANCELADO', contratoAtualId: null },
      });
    }
    return true;
  });
  if (!cancelled) return { status: 'CONCURRENT_CHANGE' as const };

  void createContractCancelledNotification({
    contaId: input.contaId,
    contratoId: contrato.id,
    matriculaId: contrato.matricula.id,
    alunoNome: contrato.matricula.aluno.nome ?? 'Aluno',
  });
  return { status: 'CANCELLED' as const };
}

export async function listStudentsWithContracts(input: {
  contaId: string;
  query?: string;
  status?: StatusAssinatura;
  turmaId?: string;
  page: number;
  pageSize: number;
}) {
  const qTerm = input.query?.toLowerCase() ?? '';
  const qDigits = (input.query ?? '').replace(/\D/g, '');
  const where: Prisma.AlunoWhereInput = {
    contaId: input.contaId,
    ...(qTerm || qDigits
      ? {
          OR: [
            { nome: { contains: qTerm, mode: 'insensitive' } },
            { nomeSocial: { contains: qTerm, mode: 'insensitive' } },
            { email: { contains: qTerm, mode: 'insensitive' } },
            ...(qDigits ? [{ cpf: { contains: qDigits } }] : []),
          ],
        }
      : {}),
    ...(input.turmaId
      ? {
          matriculas: {
            some: {
              turmaId: input.turmaId,
              contratos: { some: { ...(input.status ? { status: input.status } : {}) } },
            },
          },
        }
      : {
          AND: [{
            OR: [
              { matriculas: { some: { contratos: { some: { ...(input.status ? { status: input.status } : {}) } } } } },
              { contratosEvento: { some: { ...(input.status ? { status: input.status } : {}) } } },
            ],
          }],
        }),
  };

  const total = await prisma.aluno.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
  const page = Math.min(input.page, totalPages);
  const alunos = await prisma.aluno.findMany({
    where,
    skip: (page - 1) * input.pageSize,
    take: input.pageSize,
    select: { id: true, nome: true, foto: true },
    orderBy: { nome: 'asc' },
  });

  return { alunos, total, totalPages, page };
}

export async function getSignedContractDocument(input: { contaId: string; contratoId: string }) {
  return prisma.contratoDocumento.findFirst({
    where: {
      contaId: input.contaId,
      contratoId: input.contratoId,
      tipo: 'ASSINADO',
      contrato: { contaId: input.contaId },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getSignedEventContractDocument(input: { contaId: string; contratoId: string }) {
  return prisma.eventoContratoDocumento.findFirst({
    where: {
      contaId: input.contaId,
      eventoContratoId: input.contratoId,
      tipo: 'ASSINADO',
      eventoContrato: { contaId: input.contaId },
    },
    orderBy: { createdAt: 'desc' },
  });
}
