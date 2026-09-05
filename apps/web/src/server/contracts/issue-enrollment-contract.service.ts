import type { Prisma } from '@prisma/client';
import { isMaiorDeIdade, snapshotContractConsentTerms, type ContractConsentRenderContext } from '@alusa/domain';
import { encryptSecret } from '@alusa/database';
import { createContractEvidence, createPublicContractToken } from '@alusa/lib';
import { normalizeBrazilianWhatsAppPhone } from '@alusa/whatsapp';
import { getWhatsAppRuntimeConfig } from '@/src/server/whatsapp/config';
import {
  getMissingContractSignatureFieldsMessage,
  hasRequiredContractSignatureFields,
} from './signature-fields';

export class EnrollmentContractModelNotFoundError extends Error {
  constructor() {
    super('Modelo de contrato ativo não encontrado nesta conta.');
    this.name = 'EnrollmentContractModelNotFoundError';
  }
}

export class EnrollmentContractModelSignatureFieldsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnrollmentContractModelSignatureFieldsError';
  }
}

export class PendingEnrollmentContractAlreadyExistsError extends Error {
  constructor() {
    super('Já existe um contrato pendente para esta matrícula.');
    this.name = 'PendingEnrollmentContractAlreadyExistsError';
  }
}

export type IssueEnrollmentContractResult = {
  contrato: Awaited<ReturnType<Prisma.TransactionClient['contrato']['create']>>;
  publicToken: string | null;
  tokenExpiraEm: Date | null;
  created: boolean;
};

type IssueEnrollmentContractInput = {
  contaId: string;
  matriculaId: string;
  modeloId: string;
  actorId: string;
  contratoOrigemId?: string | null;
  expirationDays?: number;
  onExisting?: 'return' | 'reject';
  source?: 'ENROLLMENT' | 'MANUAL' | 'RENEWAL';
};

function buildSignerContext(matricula: {
  aluno: {
    nome: string;
    cpf: string | null;
    dataNasc: Date | null;
    responsaveis: Array<{
      tipoVinculo: string;
      responsavel: { nome: string; cpf: string | null };
    }>;
  };
  responsavelFinanceiro: { nome: string; cpf: string | null } | null;
}): ContractConsentRenderContext {
  const linkedResponsavelLink = matricula.aluno.responsaveis[0] ?? null;
  const linkedResponsavel = linkedResponsavelLink?.responsavel ?? null;

  if (matricula.aluno.dataNasc && isMaiorDeIdade(matricula.aluno.dataNasc)) {
    return {
      signerType: 'ALUNO_MAIOR',
      signerName: matricula.aluno.nome,
      signerCpf: matricula.aluno.cpf,
      studentName: matricula.aluno.nome,
      studentCpf: matricula.aluno.cpf,
      relationship: null,
    };
  }

  return {
    signerType: 'RESPONSAVEL',
    signerName: matricula.responsavelFinanceiro?.nome ?? linkedResponsavel?.nome ?? 'responsável legal',
    signerCpf: matricula.responsavelFinanceiro?.cpf ?? linkedResponsavel?.cpf ?? null,
    studentName: matricula.aluno.nome,
    studentCpf: matricula.aluno.cpf,
    relationship: linkedResponsavelLink?.tipoVinculo === 'PRINCIPAL' ? 'responsável legal' : 'responsável',
  };
}

function buildFieldsSnapshot(campos: Array<{
  id: string;
  tipo: string;
  papel: string;
  pagina: number;
  x: number;
  y: number;
  largura: number;
  altura: number;
  obrigatorio: boolean;
  ordem: number;
}>) {
  return campos.map((campo) => ({
    id: campo.id,
    tipo: campo.tipo,
    papel: campo.papel,
    pagina: campo.pagina,
    x: campo.x,
    y: campo.y,
    largura: campo.largura,
    altura: campo.altura,
    obrigatorio: campo.obrigatorio,
    ordem: campo.ordem,
  }));
}

export async function issueEnrollmentContract(
  tx: Prisma.TransactionClient,
  input: IssueEnrollmentContractInput,
): Promise<IssueEnrollmentContractResult> {
  const modelo = await tx.contratoModelo.findFirst({
    where: { id: input.modeloId, contaId: input.contaId, status: 'ATIVO' },
    include: {
      campos: { orderBy: { ordem: 'asc' } },
      consentimentos: { orderBy: { ordem: 'asc' } },
    },
  });

  if (!modelo) throw new EnrollmentContractModelNotFoundError();
  if (!hasRequiredContractSignatureFields(modelo.campos)) {
    throw new EnrollmentContractModelSignatureFieldsError(
      getMissingContractSignatureFieldsMessage(modelo.campos),
    );
  }

  const matricula = await tx.matricula.findFirst({
    where: { id: input.matriculaId, contaId: input.contaId, aluno: { contaId: input.contaId } },
    select: {
      id: true,
      aluno: {
        select: {
          nome: true,
          cpf: true,
          dataNasc: true,
          telefone: true,
          consentimentoComunicacoes: true,
          dataConsentimentoComunicacoes: true,
          versaoConsentimentoComunicacoes: true,
          origemConsentimentoComunicacoes: true,
          responsaveis: {
            where: { contaId: input.contaId, tipoVinculo: { in: ['FINANCEIRO', 'PRINCIPAL'] } },
            orderBy: { id: 'asc' },
            take: 1,
            select: {
              tipoVinculo: true,
              responsavel: {
                select: {
                  nome: true,
                  cpf: true,
                  telefone: true,
                  consentimentoComunicacoes: true,
                  dataConsentimentoComunicacoes: true,
                  versaoConsentimentoComunicacoes: true,
                  origemConsentimentoComunicacoes: true,
                },
              },
            },
          },
        },
      },
      responsavelFinanceiro: {
        select: {
          nome: true,
          cpf: true,
          telefone: true,
          consentimentoComunicacoes: true,
          dataConsentimentoComunicacoes: true,
          versaoConsentimentoComunicacoes: true,
          origemConsentimentoComunicacoes: true,
        },
      },
    },
  });

  if (!matricula) throw new Error('MATRICULA_NAO_ENCONTRADA');

  const existing = await tx.contrato.findFirst({
    where: { contaId: input.contaId, matriculaId: input.matriculaId, status: 'PENDENTE' },
  });
  if (existing) {
    if (input.onExisting === 'reject') throw new PendingEnrollmentContractAlreadyExistsError();
    await tx.matricula.updateMany({
      where: { id: input.matriculaId, contaId: input.contaId },
      data: { contratoAtualId: existing.id, statusContrato: 'AGUARDANDO_ASSINATURA' },
    });
    return { contrato: existing, publicToken: null, tokenExpiraEm: existing.tokenExpiraEm, created: false };
  }

  if (input.contratoOrigemId) {
    const origem = await tx.contrato.findFirst({
      where: { id: input.contratoOrigemId, contaId: input.contaId },
      select: { id: true, matriculaId: true, status: true },
    });
    if (!origem || origem.matriculaId !== input.matriculaId) throw new Error('CONTRATO_ORIGEM_INVALIDO');
    if (origem.status !== 'ASSINADO') throw new Error('CONTRATO_ORIGEM_NAO_ASSINADO');
  }

  const alunoMaior = Boolean(matricula.aluno.dataNasc && isMaiorDeIdade(matricula.aluno.dataNasc));
  const linkedResponsavel = matricula.aluno.responsaveis[0]?.responsavel ?? null;
  const recipient = alunoMaior
    ? {
        phone: matricula.aluno.telefone,
        type: 'ALUNO',
        consent: matricula.aluno.consentimentoComunicacoes,
        consentAt: matricula.aluno.dataConsentimentoComunicacoes,
        consentVersion: matricula.aluno.versaoConsentimentoComunicacoes,
        consentSource: matricula.aluno.origemConsentimentoComunicacoes,
      }
    : matricula.responsavelFinanceiro
      ? {
          phone: matricula.responsavelFinanceiro.telefone,
          type: 'RESPONSAVEL',
          consent: matricula.responsavelFinanceiro.consentimentoComunicacoes,
          consentAt: matricula.responsavelFinanceiro.dataConsentimentoComunicacoes,
          consentVersion: matricula.responsavelFinanceiro.versaoConsentimentoComunicacoes,
          consentSource: matricula.responsavelFinanceiro.origemConsentimentoComunicacoes,
        }
      : linkedResponsavel
        ? {
            phone: linkedResponsavel.telefone,
            type: 'RESPONSAVEL',
            consent: linkedResponsavel.consentimentoComunicacoes,
            consentAt: linkedResponsavel.dataConsentimentoComunicacoes,
            consentVersion: linkedResponsavel.versaoConsentimentoComunicacoes,
            consentSource: linkedResponsavel.origemConsentimentoComunicacoes,
          }
        : null;
  const consentDecisionSnapshot = {
    whatsapp: {
      granted: Boolean(recipient?.consent),
      recipientType: recipient?.type ?? null,
      recipientPhoneSuffix: recipient?.phone ? recipient.phone.replace(/\D/g, '').slice(-4) : null,
      capturedAt: recipient?.consentAt?.toISOString() ?? null,
      version: recipient?.consentVersion ?? null,
      source: recipient?.consentSource ?? null,
    },
  } as Prisma.InputJsonValue;
  const signerContext = buildSignerContext(matricula);
  const { token: publicToken, tokenHash: tokenPublicoHash } = createPublicContractToken();
  const expirationDays = Math.max(1, Math.min(90, input.expirationDays ?? 7));
  const tokenExpiraEm = new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000);
  const source = input.source ?? 'ENROLLMENT';
  const contrato = await tx.contrato.create({
    data: {
      contaId: input.contaId,
      matriculaId: input.matriculaId,
      modeloId: input.modeloId,
      contratoOrigemId: input.contratoOrigemId ?? null,
      arquivoPdfUrl: modelo.arquivoPdfUrl,
      hashPdf: modelo.hashSha256,
      camposAssinaturaSnapshot: buildFieldsSnapshot(modelo.campos),
      termosConsentimentoSnapshot: snapshotContractConsentTerms(modelo.consentimentos ?? [], signerContext),
      decisoesConsentimento: consentDecisionSnapshot,
      status: 'PENDENTE',
      // O valor bruto nunca é persistido; o prefixo mantém compatibilidade com dados legados.
      tokenPublico: `hash:${tokenPublicoHash}`,
      tokenPublicoHash,
      tokenPublicoCriptografado: encryptSecret(publicToken),
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
      mimeType: modelo.mimeType ?? 'application/pdf',
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
        mimeType: modelo.mimeType ?? 'application/pdf',
      },
    });
  }

  await createContractEvidence(tx, {
    contaId: input.contaId,
    contratoId: contrato.id,
    type: 'CONTRACT_CREATED',
    actorType: 'USER',
    actorId: input.actorId,
    payload: { matriculaId: input.matriculaId, modeloId: input.modeloId, hashPdf: modelo.hashSha256, source },
  });
  await createContractEvidence(tx, {
    contaId: input.contaId,
    contratoId: contrato.id,
    type: 'PUBLIC_LINK_CREATED',
    actorType: 'USER',
    actorId: input.actorId,
    payload: { tokenPublicoHash, tokenExpiraEm: tokenExpiraEm.toISOString() },
  });
  await tx.matricula.updateMany({
    where: { id: input.matriculaId, contaId: input.contaId },
    data: { contratoAtualId: contrato.id, statusContrato: 'AGUARDANDO_ASSINATURA' },
  });

  if (recipient?.phone && recipient.consent) {
    let normalizedPhone: string;
    try {
      normalizedPhone = normalizeBrazilianWhatsAppPhone(recipient.phone);
    } catch {
      // Telefone ausente ou inválido não pode impedir a criação do contrato.
      normalizedPhone = '';
    }
    if (normalizedPhone) {
      const whatsappConfig = getWhatsAppRuntimeConfig();
      await tx.contractWhatsAppNotification.create({
        data: {
          contaId: input.contaId,
          contratoId: contrato.id,
          matriculaId: input.matriculaId,
          templateName: alunoMaior ? whatsappConfig.contractMajorTemplateName : whatsappConfig.contractMinorTemplateName,
          languageCode: whatsappConfig.contractTemplateLanguage,
          recipientPhone: normalizedPhone,
          recipientType: recipient.type,
          tokenCriptografado: encryptSecret(publicToken),
          correlationId: `contract:${contrato.id}`,
          consentimentoRegistrado: true,
          consentimentoVersao: recipient.consentVersion ?? '2026-09-05',
          consentimentoOrigem: recipient.consentSource ?? 'ALUNO_WIZARD',
          consentimentoRegistradoEm: recipient.consentAt ?? new Date(),
        },
      });
    }
  } else {
    if (tx.auditLog?.create) {
      await tx.auditLog.create({
        data: {
          contaId: input.contaId,
          actorType: 'SYSTEM',
          action: 'WHATSAPP_CONTRATO_NAO_ENFILEIRADO_SEM_CONSENTIMENTO',
          entityType: 'CONTRATO',
          entityId: contrato.id,
          correlationId: `contract:${contrato.id}`,
          metadata: {
            recipientType: recipient?.type ?? null,
            hasPhone: Boolean(recipient?.phone),
            consentimentoComunicacoes: Boolean(recipient?.consent),
          },
        },
      });
    }
  }

  return { contrato, publicToken, tokenExpiraEm, created: true };
}
