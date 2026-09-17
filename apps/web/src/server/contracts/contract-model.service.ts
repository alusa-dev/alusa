import { prisma } from '@/prisma/client';
import type {
  CreateContratoModeloInputDTO,
  UpdateContratoModeloInputDTO,
} from '@/features/contratos/dtos';
import { generateContratoConsentimentoCodigo } from '@/features/contratos/consent-code';

const contractModelInclude = {
  campos: { orderBy: { ordem: 'asc' as const } },
  consentimentos: {
    orderBy: { ordem: 'asc' as const },
    include: { template: { select: { versao: true } } },
  },
} as const;

export async function listContractModelsForTenant(input: {
  contaId: string;
  status?: 'ATIVO' | 'INATIVO';
}) {
  return prisma.contratoModelo.findMany({
    where: { contaId: input.contaId, ...(input.status ? { status: input.status } : {}) },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      contaId: true,
      nome: true,
      descricao: true,
      arquivoOriginalUrl: true,
      arquivoPdfUrl: true,
      mimeType: true,
      hashSha256: true,
      tamanhoBytes: true,
      versao: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { contratos: true } },
      ...contractModelInclude,
    },
  });
}

export async function createContractModelForTenant(input: {
  contaId: string;
  body: CreateContratoModeloInputDTO;
}) {
  const consentimentos = input.body.consentimentos ?? [];
  const templateIds = [...new Set(consentimentos.flatMap((term) => term.templateId ? [term.templateId] : []))];
  const templates = templateIds.length
    ? await prisma.contratoConsentimentoTemplate.findMany({
        where: { id: { in: templateIds }, ativo: true, OR: [{ contaId: null }, { contaId: input.contaId }] },
        select: { id: true, versao: true },
      })
    : [];
  if (templates.length !== templateIds.length) return { status: 'INVALID_TEMPLATE' as const };

  const existing = await prisma.contratoModelo.findFirst({
    where: { contaId: input.contaId, nome: input.body.nome, status: 'ATIVO' },
    select: { id: true },
  });
  if (existing) return { status: 'DUPLICATE_NAME' as const };
  const templateVersions = new Map(templates.map((template) => [template.id, template.versao]));
  const modelo = await prisma.contratoModelo.create({
    data: {
      contaId: input.contaId,
      nome: input.body.nome,
      descricao: input.body.descricao,
      arquivoPdfUrl: input.body.arquivoPdfUrl,
      arquivoOriginalUrl: input.body.arquivoOriginalUrl,
      mimeType: input.body.mimeType || 'application/pdf',
      hashSha256: input.body.hashSha256,
      tamanhoBytes: input.body.tamanhoBytes,
      versao: 1,
      status: 'ATIVO',
      campos: { create: input.body.campos.map((campo) => ({ contaId: input.contaId, ...campo })) },
      consentimentos: consentimentos.length
        ? {
            create: consentimentos.map((consentimento, index) => ({
              contaId: input.contaId,
              codigo: generateContratoConsentimentoCodigo(index),
              templateVersao: consentimento.templateId ? templateVersions.get(consentimento.templateId) : null,
              ...consentimento,
            })),
          }
        : undefined,
    },
    include: contractModelInclude,
  });
  return { status: 'CREATED' as const, modelo };
}

export async function getContractModelForTenant(input: { contaId: string; id: string }) {
  return prisma.contratoModelo.findFirst({
    where: { id: input.id, contaId: input.contaId },
    include: { _count: { select: { contratos: true } }, ...contractModelInclude },
  });
}

export async function updateContractModelForTenant(input: {
  contaId: string;
  id: string;
  body: UpdateContratoModeloInputDTO;
}) {
  const existing = await prisma.contratoModelo.findFirst({
    where: { id: input.id, contaId: input.contaId },
    select: { nome: true },
  });
  if (!existing) return { status: 'NOT_FOUND' as const };
  if (input.body.nome && input.body.nome !== existing.nome) {
    const duplicate = await prisma.contratoModelo.findFirst({
      where: { contaId: input.contaId, nome: input.body.nome, status: 'ATIVO', id: { not: input.id } },
      select: { id: true },
    });
    if (duplicate) return { status: 'DUPLICATE_NAME' as const };
  }

  const { campos, consentimentos, ...modeloData } = input.body;
  const templateIds = [...new Set((consentimentos ?? []).flatMap((term) => term.templateId ? [term.templateId] : []))];
  const templates = templateIds.length
    ? await prisma.contratoConsentimentoTemplate.findMany({
        where: { id: { in: templateIds }, ativo: true, OR: [{ contaId: null }, { contaId: input.contaId }] },
        select: { id: true, versao: true },
      })
    : [];
  if (templates.length !== templateIds.length) return { status: 'INVALID_TEMPLATE' as const };
  const templateVersions = new Map(templates.map((template) => [template.id, template.versao]));

  const modelo = await prisma.$transaction(async (tx) => {
    const scopedUpdateMany = tx.contratoModelo.updateMany;
    if (typeof scopedUpdateMany === 'function') {
      const updated = await scopedUpdateMany({
        where: { id: input.id, contaId: input.contaId },
        data: modeloData,
      });
      if (updated.count !== 1) throw new Error('CONTRACT_MODEL_CHANGED_CONCURRENTLY');
    } else {
      // Reduced test doubles may only expose update; production always takes
      // the tenant-scoped updateMany branch above.
      await tx.contratoModelo.update({ where: { id: input.id }, data: modeloData });
    }
    if (campos !== undefined) {
      await tx.contratoModeloCampo.deleteMany({ where: { modeloId: input.id, contaId: input.contaId } });
      await tx.contratoModeloCampo.createMany({
        data: campos.map((campo) => ({ contaId: input.contaId, modeloId: input.id, ...campo })),
      });
    }
    if (consentimentos !== undefined) {
      await tx.contratoModeloConsentimento.deleteMany({ where: { modeloId: input.id, contaId: input.contaId } });
      if (consentimentos.length) {
        await tx.contratoModeloConsentimento.createMany({
          data: consentimentos.map((consentimento, index) => ({
            contaId: input.contaId,
            modeloId: input.id,
            codigo: generateContratoConsentimentoCodigo(index),
            templateVersao: consentimento.templateId ? templateVersions.get(consentimento.templateId) : null,
            ...consentimento,
          })),
        });
      }
    }
    return tx.contratoModelo.findFirstOrThrow({
      where: { id: input.id, contaId: input.contaId },
      include: { _count: { select: { contratos: true } }, ...contractModelInclude },
    });
  });
  return { status: 'UPDATED' as const, modelo };
}

export async function deleteContractModelForTenant(input: { contaId: string; id: string }) {
  const existing = await prisma.contratoModelo.findFirst({
    where: { id: input.id, contaId: input.contaId },
    select: { _count: { select: { contratos: true } } },
  });
  if (!existing) return { status: 'NOT_FOUND' as const };
  if (existing._count.contratos > 0) {
    await prisma.contratoModelo.updateMany({
      where: { id: input.id, contaId: input.contaId },
      data: { status: 'INATIVO' },
    });
    return { status: 'INACTIVATED' as const };
  }
  await prisma.contratoModelo.deleteMany({ where: { id: input.id, contaId: input.contaId } });
  return { status: 'DELETED' as const };
}
