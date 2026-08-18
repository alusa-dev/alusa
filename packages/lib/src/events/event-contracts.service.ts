import type { ContractEvidenceType, Prisma, PrismaClient, StatusAssinatura } from '@prisma/client';
import {
  buildSignaturePayload,
  CONTRACT_ACCEPTANCE_TEXT_V1,
  CONTRACT_ACCEPTANCE_VERSION,
  buildContractConsentPayload,
  hashCanonicalPayload,
  validateContractSigner,
  resolveContractConsentAnswers,
  isMaiorDeIdade,
  renderContractConsentTemplate,
  type ContractConsentAnswer,
  type ContractConsentTermSnapshot,
} from '@alusa/domain';
import { snapshotContractConsentTerms } from '@alusa/domain';
import { createPublicContractToken } from '../contracts/tokens';
import { generateSignedContractEvidencePdf } from '../contracts/pdf/generate-signed-contract-pdf';
import { prisma } from '../prisma';

type DbClient = PrismaClient | Prisma.TransactionClient;

type EventContractContext = {
  contaId: string;
  userId: string;
};

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function persistEventContractConsentRecords(
  tx: Prisma.TransactionClient,
  input: {
    contaId: string;
    eventoContratoId: string;
    alunoId: string;
    signedAt: Date;
    consentimentos: Array<{
      id: string;
      codigo: string;
      titulo: string;
      finalidade: string;
      decision: 'AUTORIZADO' | 'RECUSADO';
    }>;
  },
) {
  await Promise.all(input.consentimentos.map((consentimento) => {
    const source = `EVENT_CONTRACT:${input.eventoContratoId}:${consentimento.id}`;
    const status = consentimento.decision === 'AUTORIZADO' ? 'GRANTED' : 'DENIED';

    return tx.consentRecord.upsert({
      where: {
        uq_consent_record_conta_source: {
          contaId: input.contaId,
          source,
        },
      },
      create: {
        contaId: input.contaId,
        subjectType: 'ALUNO',
        subjectId: input.alunoId,
        consentType: consentimento.finalidade,
        legalBasis: 'CONSENTIMENTO',
        status,
        grantedAt: input.signedAt,
        source,
        metadata: jsonValue({
          eventoContratoId: input.eventoContratoId,
          termoId: consentimento.id,
          codigo: consentimento.codigo,
          titulo: consentimento.titulo,
          finalidade: consentimento.finalidade,
          decision: consentimento.decision,
        }),
      },
      update: {
        status,
        grantedAt: input.signedAt,
        revokedAt: null,
        metadata: jsonValue({
          eventoContratoId: input.eventoContratoId,
          termoId: consentimento.id,
          codigo: consentimento.codigo,
          titulo: consentimento.titulo,
          finalidade: consentimento.finalidade,
          decision: consentimento.decision,
        }),
      },
    });
  }));
}

async function recordEvidence(
  tx: Prisma.TransactionClient,
  input: {
    contaId: string;
    eventoContratoId: string;
    type: ContractEvidenceType;
    actorType?: string | null;
    actorId?: string | null;
    payload: unknown;
  },
) {
  const payload = jsonValue(input.payload);
  await tx.eventoContratoEvidence.create({
    data: {
      contaId: input.contaId,
      eventoContratoId: input.eventoContratoId,
      type: input.type,
      actorType: input.actorType ?? null,
      actorId: input.actorId ?? null,
      payload,
      payloadHash: hashCanonicalPayload(payload),
    },
  });
}

function snapshotFields(fields: Array<{
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
  return fields.map((field) => ({ ...field }));
}

export function mapEventContract(contract: any) {
  const consentTerms = Array.isArray(contract.termosConsentimentoSnapshot) ? contract.termosConsentimentoSnapshot : [];
  const consentDecisions = Array.isArray(contract.decisoesConsentimento) ? contract.decisoesConsentimento : [];

  return {
    id: contract.id,
    origin: 'EVENT' as const,
    eventId: contract.eventId,
    participantId: contract.participantId,
    alunoId: contract.alunoId,
    aluno: contract.aluno ? { id: contract.aluno.id, nome: contract.aluno.nome, cpf: contract.aluno.cpf ?? null } : null,
    responsavelId: contract.responsavelId ?? null,
    responsavel: contract.responsavel ? { id: contract.responsavel.id, nome: contract.responsavel.nome, cpf: contract.responsavel.cpf } : null,
    evento: contract.evento ? { id: contract.evento.id, name: contract.evento.name, startsAt: contract.evento.startsAt.toISOString() } : null,
    modelo: contract.modelo ? { id: contract.modelo.id, nome: contract.modelo.nome, versao: contract.modelo.versao } : null,
    arquivoPdfUrl: contract.arquivoPdfUrl,
    hashPdf: contract.hashPdf,
    arquivoPdfAssinadoUrl: contract.arquivoPdfAssinadoUrl ?? null,
    hashPdfAssinado: contract.hashPdfAssinado ?? null,
    status: contract.status,
    assinadoPor: contract.assinadoPor ?? null,
    assinadoEmail: contract.assinadoEmail ?? null,
    assinadoCpf: contract.assinadoCpf ?? null,
    assinadoEm: contract.assinadoEm?.toISOString?.() ?? null,
    tokenPublico: contract.tokenPublico?.startsWith('hash:') ? '' : contract.tokenPublico,
    tokenExpiraEm: contract.tokenExpiraEm?.toISOString?.() ?? null,
    consentimentos: consentTerms.map((term: any) => ({
      id: String(term.id),
      codigo: term.codigo ?? null,
      titulo: term.titulo ?? 'Consentimento',
      finalidade: term.finalidade ?? null,
      decision: consentDecisions.find((decision: any) => decision.id === term.id)?.decision ?? null,
    })),
    createdAt: contract.createdAt.toISOString(),
    updatedAt: contract.updatedAt.toISOString(),
  };
}

async function getEventContractRecord(db: DbClient, contaId: string, id: string) {
  return db.eventoContrato.findFirst({
    where: { id, contaId },
    include: {
      aluno: { select: { id: true, nome: true, cpf: true } },
      responsavel: { select: { id: true, nome: true, cpf: true } },
      evento: { select: { id: true, name: true, startsAt: true } },
      modelo: { select: { id: true, nome: true, versao: true } },
    },
  });
}

export async function createEventContractForParticipant(
  tx: Prisma.TransactionClient,
  input: EventContractContext & { eventId: string; participantId: string; alunoId: string },
) {
  const participant = await tx.eventParticipant.findFirst({
    where: { id: input.participantId, eventId: input.eventId, alunoId: input.alunoId, contaId: input.contaId },
    include: {
      event: { select: { id: true, name: true, contratoModeloId: true } },
      aluno: {
        select: {
          id: true,
          nome: true,
          cpf: true,
          dataNasc: true,
          responsaveis: {
            where: { contaId: input.contaId, tipoVinculo: { in: ['FINANCEIRO', 'PRINCIPAL'] } },
            orderBy: { id: 'asc' },
            take: 1,
            include: { responsavel: { select: { id: true, nome: true, cpf: true } } },
          },
        },
      },
    },
  });

  if (!participant?.aluno || !participant.event.contratoModeloId) return null;

  const existing = await tx.eventoContrato.findFirst({
    where: { contaId: input.contaId, participantId: input.participantId },
  });
  if (existing) return existing;

  const modelo = await tx.contratoModelo.findFirst({
    where: { id: participant.event.contratoModeloId, contaId: input.contaId, status: 'ATIVO' },
    include: {
      campos: { orderBy: { ordem: 'asc' } },
      consentimentos: { orderBy: { ordem: 'asc' }, include: { template: { select: { id: true, versao: true } } } },
    },
  });
  if (!modelo) throw new Error('MODELO_CONTRATO_EVENTO_NAO_ENCONTRADO');

  const requiredSignature = modelo.campos.some((field) => field.tipo === 'ASSINATURA' && field.obrigatorio);
  if (!requiredSignature) throw new Error('MODELO_CONTRATO_EVENTO_SEM_ASSINATURA');

  const { tokenHash } = createPublicContractToken();
  const tokenExpiraEm = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const responsavel = participant.aluno.responsaveis[0]?.responsavel ?? null;
  const signerContext = isMaiorDeIdade(participant.aluno.dataNasc)
    ? {
        signerType: 'ALUNO_MAIOR' as const,
        signerName: participant.aluno.nome,
        signerCpf: participant.aluno.cpf,
        studentName: participant.aluno.nome,
        studentCpf: participant.aluno.cpf,
        relationship: null,
      }
    : {
        signerType: 'RESPONSAVEL' as const,
        signerName: responsavel?.nome ?? 'responsável legal',
        signerCpf: responsavel?.cpf ?? null,
        studentName: participant.aluno.nome,
        studentCpf: participant.aluno.cpf,
        relationship: 'responsável legal',
      };
  const contrato = await tx.eventoContrato.create({
    data: {
      contaId: input.contaId,
      eventId: input.eventId,
      participantId: input.participantId,
      alunoId: input.alunoId,
      responsavelId: responsavel?.id ?? null,
      modeloId: modelo.id,
      arquivoPdfUrl: modelo.arquivoPdfUrl,
      hashPdf: modelo.hashSha256,
      camposAssinaturaSnapshot: snapshotFields(modelo.campos),
      termosConsentimentoSnapshot: snapshotContractConsentTerms(modelo.consentimentos ?? []).map((term) => ({
        ...term,
        texto: renderContractConsentTemplate(term.texto, signerContext),
        templateId: modelo.consentimentos.find((item) => item.id === term.id)?.templateId ?? null,
        templateVersao: modelo.consentimentos.find((item) => item.id === term.id)?.templateVersao ?? null,
        contexto: signerContext,
      })),
      status: 'PENDENTE',
      tokenPublico: `hash:${tokenHash}`,
      tokenPublicoHash: tokenHash,
      tokenExpiraEm,
      createdByUserId: input.userId,
    },
  });

  await tx.eventoContratoDocumento.create({
    data: {
      contaId: input.contaId,
      eventoContratoId: contrato.id,
      tipo: 'GERADO_EVENTO',
      arquivoUrl: modelo.arquivoPdfUrl,
      hashSha256: modelo.hashSha256,
      tamanhoBytes: modelo.tamanhoBytes,
      mimeType: modelo.mimeType,
    },
  });

  await recordEvidence(tx, {
    contaId: input.contaId,
    eventoContratoId: contrato.id,
    type: 'CONTRACT_CREATED',
    actorType: 'USER',
    actorId: input.userId,
    payload: { eventId: input.eventId, participantId: input.participantId, alunoId: input.alunoId, modeloId: modelo.id },
  });
  await recordEvidence(tx, {
    contaId: input.contaId,
    eventoContratoId: contrato.id,
    type: 'PUBLIC_LINK_CREATED',
    actorType: 'USER',
    actorId: input.userId,
    payload: { tokenExpiraEm: tokenExpiraEm.toISOString() },
  });

  return contrato;
}

export async function listEventContractsByStudent(contaId: string, alunoId: string, status?: StatusAssinatura) {
  const records = await prisma.eventoContrato.findMany({
    where: { contaId, alunoId, ...(status ? { status } : {}) },
    include: {
      aluno: { select: { id: true, nome: true, cpf: true } },
      responsavel: { select: { id: true, nome: true, cpf: true } },
      evento: { select: { id: true, name: true, startsAt: true } },
      modelo: { select: { id: true, nome: true, versao: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return records.map(mapEventContract);
}

export async function getEventContract(ctx: Pick<EventContractContext, 'contaId'>, id: string) {
  const record = await getEventContractRecord(prisma, ctx.contaId, id);
  return record ? mapEventContract(record) : null;
}

export async function regenerateEventContractToken(ctx: EventContractContext, id: string) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.eventoContrato.findFirst({ where: { id, contaId: ctx.contaId } });
    if (!current) throw new Error('CONTRATO_EVENTO_NAO_ENCONTRADO');
    if (current.status === 'ASSINADO' || current.status === 'CANCELADO') throw new Error('CONTRATO_EVENTO_NAO_REGENERAVEL');
    const { token, tokenHash } = createPublicContractToken();
    await tx.eventoContrato.update({
      where: { id },
      data: { tokenPublico: `hash:${tokenHash}`, tokenPublicoHash: tokenHash, tokenExpiraEm: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), status: 'PENDENTE' },
    });
    await recordEvidence(tx, { contaId: ctx.contaId, eventoContratoId: id, type: 'PUBLIC_LINK_CREATED', actorType: 'USER', actorId: ctx.userId, payload: { regenerated: true } });
    const record = await getEventContractRecord(tx, ctx.contaId, id);
    if (!record) throw new Error('CONTRATO_EVENTO_NAO_ENCONTRADO');
    return { ...mapEventContract(record), tokenPublico: token };
  });
}

export async function findPublicEventContractByToken(token: string) {
  const { hashPublicContractToken } = await import('../contracts/tokens');
  const tokenHash = hashPublicContractToken(token);
  return prisma.eventoContrato.findFirst({
    where: {
      OR: [
        { tokenPublicoHash: tokenHash },
        { tokenPublicoHash: null, tokenPublico: token },
      ],
    },
    include: {
      conta: { select: { id: true, nome: true } },
      aluno: {
        select: {
          id: true,
          nome: true,
          cpf: true,
          dataNasc: true,
          responsaveis: {
            where: {},
            orderBy: { id: 'asc' },
            take: 10,
            select: { contaId: true, responsavel: { select: { nome: true, cpf: true } } },
          },
        },
      },
      responsavel: { select: { id: true, nome: true, cpf: true } },
      evento: { select: { id: true, name: true, startsAt: true } },
      modelo: { include: { campos: { orderBy: { ordem: 'asc' } }, consentimentos: { orderBy: { ordem: 'asc' } } } },
    },
  });
}

export function mapPublicEventContractToDTO(contract: any) {
  const fields = Array.isArray(contract.camposAssinaturaSnapshot)
    ? contract.camposAssinaturaSnapshot
    : contract.modelo?.campos ?? [];
  return {
    id: contract.id,
    arquivoPdfUrl: contract.arquivoPdfUrl,
    hashPdf: contract.hashPdf,
    status: contract.status,
    tokenExpiraEm: contract.tokenExpiraEm?.toISOString?.() ?? null,
    acceptanceText: CONTRACT_ACCEPTANCE_TEXT_V1,
    acceptanceVersion: CONTRACT_ACCEPTANCE_VERSION,
    consentimentos: Array.isArray(contract.termosConsentimentoSnapshot)
      ? contract.termosConsentimentoSnapshot
      : contract.modelo?.consentimentos?.map((term: any) => ({
          id: term.id,
          codigo: term.codigo,
          finalidade: term.finalidade,
          titulo: term.titulo,
          texto: term.texto,
          papel: 'RESPONSAVEL_OU_ALUNO',
          obrigatorio: term.obrigatorio,
          recusaImpedeAssinatura: term.recusaImpedeAssinatura,
          ordem: term.ordem,
        })) ?? [],
    escolaNome: contract.conta.nome,
    matricula: {
      aluno: { nome: contract.aluno.nome },
      responsavelFinanceiro: contract.responsavel ? { nome: contract.responsavel.nome } : null,
    },
    evento: contract.evento ? { id: contract.evento.id, nome: contract.evento.name, startsAt: contract.evento.startsAt.toISOString() } : null,
    camposAssinatura: fields.map((field: any) => ({
      id: String(field.id), tipo: field.tipo, papel: field.papel, pagina: Number(field.pagina), x: Number(field.x), y: Number(field.y), largura: Number(field.largura), altura: Number(field.altura), obrigatorio: Boolean(field.obrigatorio), ordem: Number(field.ordem ?? 0),
    })),
  };
}

function decodePdfDataUrl(value: string) {
  const match = value.match(/^data:application\/pdf;base64,(.+)$/);
  return match ? Buffer.from(match[1], 'base64') : null;
}

async function loadPdfBytes(url: string, baseUrl?: string | null) {
  const dataUrlBytes = decodePdfDataUrl(url);
  if (dataUrlBytes) return dataUrlBytes;
  const fallback = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  const target = /^https?:\/\//i.test(url) ? url : (baseUrl || fallback) ? new URL(url, baseUrl || fallback || undefined).toString() : null;
  if (!target) throw new Error('SIGNED_PDF_SOURCE_UNAVAILABLE');
  const response = await fetch(target);
  if (!response.ok) throw new Error('SIGNED_PDF_SOURCE_UNAVAILABLE');
  return Buffer.from(await response.arrayBuffer());
}

export async function signPublicEventContract(input: {
  token: string;
  cpf: string;
  nome: string;
  email?: string | null;
  aceite: true;
  consentimentos?: ContractConsentAnswer[];
  ip?: string | null;
  userAgent?: string | null;
  baseUrl?: string | null;
  assinatura: { tipo: 'TEXTO' | 'DESENHADA'; valor: string; fonte?: string };
}) {
  const contract = await findPublicEventContractByToken(input.token);
  if (!contract) throw new Error('CONTRACT_NOT_FOUND');
  const now = new Date();
  if (contract.status === 'ASSINADO') throw new Error('CONTRACT_ALREADY_SIGNED');
  if (contract.status === 'CANCELADO') throw new Error('CONTRACT_CANCELLED');
  if (contract.status === 'EXPIRADO') throw new Error('CONTRACT_EXPIRED');
  if (contract.tokenExpiraEm && now > contract.tokenExpiraEm) throw new Error('CONTRACT_LINK_EXPIRED');

  const consentTerms: ContractConsentTermSnapshot[] = Array.isArray(contract.termosConsentimentoSnapshot)
    ? contract.termosConsentimentoSnapshot as ContractConsentTermSnapshot[]
    : (contract.modelo?.consentimentos ?? []).map((term: any) => ({
        id: term.id,
        codigo: term.codigo,
        finalidade: term.finalidade,
        titulo: term.titulo,
        texto: term.texto,
        papel: 'RESPONSAVEL_OU_ALUNO' as const,
        obrigatorio: term.obrigatorio,
        recusaImpedeAssinatura: term.recusaImpedeAssinatura,
        ordem: term.ordem,
      }));
  const consentimentos = resolveContractConsentAnswers(consentTerms, input.consentimentos ?? []);
  const consentimentosPayload = buildContractConsentPayload(consentimentos);

  const signer = validateContractSigner({
    cpf: input.cpf,
    now,
    aluno: contract.aluno,
    responsavelFinanceiro: contract.responsavel,
    responsaveis: contract.aluno.responsaveis
      .filter((item: { contaId: string }) => item.contaId === contract.contaId)
      .map((item: { responsavel: { nome: string; cpf: string } }) => item.responsavel),
  });
  if (!signer.ok) throw new Error(signer.code);

  const signaturePayload = buildSignaturePayload({
    contratoId: contract.id,
    matriculaId: contract.eventId,
    contaId: contract.contaId,
    hashPdf: contract.hashPdf,
    cpf: signer.signer.cpf,
    nome: signer.signer.nome,
    email: input.email ?? null,
    assinadoEmIso: now.toISOString(),
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    assinatura: input.assinatura,
    consentimentos: consentimentosPayload,
  });
  const signatureHash = hashCanonicalPayload(signaturePayload);
  const signedPdf = await generateSignedContractEvidencePdf({
    contratoId: contract.id,
    matriculaId: contract.eventId,
    contextLabel: 'Evento',
    contextId: contract.eventId,
    contaNome: contract.conta.nome,
    alunoNome: contract.aluno.nome,
    signerName: signer.signer.nome,
    signerCpf: signer.signer.cpf,
    email: input.email ?? null,
    signedAtIso: now.toISOString(),
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    originalPdfHash: contract.hashPdf,
    presentedPdfHash: contract.hashPdf,
    signatureHash,
    originalPdfBytes: await loadPdfBytes(contract.arquivoPdfUrl, input.baseUrl),
    assinatura: input.assinatura,
    camposAssinatura: (Array.isArray(contract.camposAssinaturaSnapshot) ? contract.camposAssinaturaSnapshot : contract.modelo.campos).map((field: any) => ({
      tipo: field.tipo,
      papel: field.papel,
      pagina: field.pagina,
      x: field.x,
      y: field.y,
      largura: field.largura,
      altura: field.altura,
    })),
    consentimentos: consentimentosPayload,
  });

  const signedPdfUrl = `/api/event-contracts/${contract.id}/documentos/assinado`;
  await prisma.$transaction(async (tx) => {
    await recordEvidence(tx, { contaId: contract.contaId, eventoContratoId: contract.id, type: 'SIGNATURE_ACCEPTED', actorType: 'PUBLIC', payload: { aceite: true, acceptanceText: CONTRACT_ACCEPTANCE_TEXT_V1, acceptanceVersion: CONTRACT_ACCEPTANCE_VERSION, payloadHash: signatureHash, consentimentos: consentimentosPayload } });
    if (consentimentosPayload.length) {
      await recordEvidence(tx, { contaId: contract.contaId, eventoContratoId: contract.id, type: 'CONSENT_DECISION_RECORDED', actorType: 'PUBLIC', payload: { consentimentos: consentimentosPayload } });
      await persistEventContractConsentRecords(tx, {
        contaId: contract.contaId,
        eventoContratoId: contract.id,
        alunoId: contract.alunoId,
        signedAt: now,
        consentimentos: consentimentosPayload,
      });
      const imageConsent = consentimentosPayload.find((consentimento) => consentimento.finalidade === 'IMAGE_USE');
      if (imageConsent) {
        await tx.aluno.updateMany({
          where: { id: contract.alunoId, contaId: contract.contaId },
          data: {
            consentimentoImagem: imageConsent.decision === 'AUTORIZADO',
            dataConsentimentoImagem: imageConsent.decision === 'AUTORIZADO' ? now : null,
          },
        });
      }
    }
    const updated = await tx.eventoContrato.updateMany({
      where: { id: contract.id, contaId: contract.contaId, status: 'PENDENTE' },
      data: { status: 'ASSINADO', assinadoPor: signer.signer.nome, assinadoCpf: signer.signer.cpf, assinadoEmail: input.email ?? null, assinadoIp: input.ip ?? null, assinadoUserAgent: input.userAgent ?? null, assinadoEm: now, hashAssinatura: signatureHash, arquivoPdfAssinadoUrl: signedPdfUrl, hashPdfAssinado: signedPdf.hashSha256, decisoesConsentimento: consentimentosPayload },
    });
    if (updated.count !== 1) throw new Error('CONTRACT_ALREADY_SIGNED');
    await tx.eventoContratoDocumento.create({ data: { contaId: contract.contaId, eventoContratoId: contract.id, tipo: 'ASSINADO', arquivoUrl: signedPdf.dataUrl, hashSha256: signedPdf.hashSha256, tamanhoBytes: signedPdf.tamanhoBytes } });
    await tx.eventoContratoDocumento.create({ data: { contaId: contract.contaId, eventoContratoId: contract.id, tipo: 'CERTIFICADO_EVIDENCIAS', arquivoUrl: signedPdf.dataUrl, hashSha256: signedPdf.hashSha256, tamanhoBytes: signedPdf.tamanhoBytes } });
    await recordEvidence(tx, { contaId: contract.contaId, eventoContratoId: contract.id, type: 'SIGNED_PDF_GENERATED', actorType: 'PUBLIC', payload: { signedPdfHash: signedPdf.hashSha256, assinatura: signer.signer.type } });
  });

  return { success: true as const, hash: signatureHash, signedPdfHash: signedPdf.hashSha256, signedPdfUrl, contaId: contract.contaId, contratoId: contract.id, alunoNome: contract.aluno.nome, assinadoPor: signer.signer.nome };
}
