import type { Prisma } from '@prisma/client';
import {
  buildSignaturePayload,
  CONTRACT_ACCEPTANCE_TEXT_V1,
  CONTRACT_ACCEPTANCE_VERSION,
  hashCanonicalPayload,
  validateContractSigner,
} from '@alusa/domain';
import { prisma } from '../../prisma';
import { createContractEvidence } from '../evidence/create-contract-evidence';
import { generateSignedContractEvidencePdf } from '../pdf/generate-signed-contract-pdf';
import { hashPublicContractToken } from '../tokens';

type SignPublicContractInput = {
  token: string;
  cpf: string;
  nome: string;
  email?: string | null;
  aceite: true;
  ip?: string | null;
  userAgent?: string | null;
  baseUrl?: string | null;
};

type SignPublicContractResult = {
  success: true;
  hash: string;
  signedPdfHash: string;
  signedPdfUrl: string;
  contaId: string;
  contratoId: string;
  matriculaId: string;
  alunoNome: string;
  assinadoPor: string;
};

function sanitizeUserAgent(value: string | null | undefined) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 512);
}

function decodePdfDataUrl(value: string) {
  const prefix = 'data:application/pdf;base64,';
  if (!value.startsWith(prefix)) return null;
  return Buffer.from(value.slice(prefix.length), 'base64');
}

async function loadPresentedPdfBytes(url: string, baseUrl?: string | null) {
  const dataUrlBytes = decodePdfDataUrl(url);
  if (dataUrlBytes) return dataUrlBytes;

  const fallbackBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL
    ?? process.env.APP_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    ?? (process.env.NODE_ENV === 'production' ? null : `http://localhost:${process.env.PORT ?? '3000'}`);

  const target = /^https?:\/\//i.test(url)
    ? url
    : (baseUrl || fallbackBaseUrl)
      ? new URL(url, baseUrl || fallbackBaseUrl || undefined).toString()
      : null;

  if (!target) {
    throw new Error('SIGNED_PDF_SOURCE_UNAVAILABLE');
  }

  const response = await fetch(target);
  if (!response.ok) {
    throw new Error('SIGNED_PDF_SOURCE_UNAVAILABLE');
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType && !contentType.toLowerCase().includes('pdf')) {
    throw new Error('SIGNED_PDF_SOURCE_UNAVAILABLE');
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function findPublicContractByToken(token: string) {
  const tokenHash = hashPublicContractToken(token);

  return prisma.contrato.findFirst({
    where: {
      OR: [
        { tokenPublicoHash: tokenHash },
        {
          tokenPublicoHash: null,
          tokenPublico: token,
        },
      ],
    },
    include: {
      conta: { select: { id: true, nome: true } },
      matricula: {
        select: {
          id: true,
          aluno: { select: { nome: true, cpf: true, dataNasc: true, contaId: true } },
          responsavelFinanceiro: { select: { nome: true, cpf: true } },
        },
      },
    },
  });
}

export async function signPublicContract(input: SignPublicContractInput): Promise<SignPublicContractResult> {
  const now = new Date();
  const userAgent = sanitizeUserAgent(input.userAgent);
  const contrato = await findPublicContractByToken(input.token);

  if (!contrato) {
    throw new Error('CONTRACT_NOT_FOUND');
  }

  if (contrato.status === 'ASSINADO') throw new Error('CONTRACT_ALREADY_SIGNED');
  if (contrato.status === 'CANCELADO') throw new Error('CONTRACT_CANCELLED');
  if (contrato.status === 'EXPIRADO') throw new Error('CONTRACT_EXPIRED');
  if (contrato.tokenExpiraEm && now > contrato.tokenExpiraEm) throw new Error('CONTRACT_LINK_EXPIRED');

  const signer = validateContractSigner({
    cpf: input.cpf,
    now,
    aluno: contrato.matricula.aluno,
    responsavelFinanceiro: contrato.matricula.responsavelFinanceiro,
  });

  if (!signer.ok) {
    await createContractEvidence(prisma as never, {
      contaId: contrato.contaId,
      contratoId: contrato.id,
      type: 'SIGNATURE_REJECTED',
      ip: input.ip ?? null,
      userAgent,
      payload: {
        reason: signer.code,
        cpfHash: hashCanonicalPayload({ cpf: input.cpf.replace(/\D/g, '') }),
      },
    }).catch(() => undefined);
    throw new Error(signer.code);
  }

  const signaturePayload = buildSignaturePayload({
    contratoId: contrato.id,
    matriculaId: contrato.matriculaId,
    contaId: contrato.contaId,
    hashPdf: contrato.hashPdf,
    cpf: signer.signer.cpf,
    nome: signer.signer.nome,
    email: input.email ?? null,
    assinadoEmIso: now.toISOString(),
    ip: input.ip ?? null,
    userAgent,
  });
  const signatureHash = hashCanonicalPayload(signaturePayload);

  const originalPdfBytes = await loadPresentedPdfBytes(contrato.arquivoPdfUrl, input.baseUrl);
  const signedPdf = await generateSignedContractEvidencePdf({
    contratoId: contrato.id,
    matriculaId: contrato.matriculaId,
    contaNome: contrato.conta.nome,
    alunoNome: contrato.matricula.aluno.nome,
    signerName: signer.signer.nome,
    signerCpf: signer.signer.cpf,
    email: input.email ?? null,
    signedAtIso: now.toISOString(),
    ip: input.ip ?? null,
    userAgent,
    originalPdfHash: contrato.hashPdf,
    presentedPdfHash: contrato.hashPdf,
    signatureHash,
    originalPdfBytes,
  });

  const signedPdfUrl = `/api/contratos/${contrato.id}/documentos/assinado`;

  await prisma.$transaction(async (tx) => {
    await createContractEvidence(tx as never, {
      contaId: contrato.contaId,
      contratoId: contrato.id,
      type: 'SIGNATURE_STARTED',
      ip: input.ip ?? null,
      userAgent,
      payload: {
        signerType: signer.signer.type,
        emailProvided: Boolean(input.email),
      },
    });

    await createContractEvidence(tx as never, {
      contaId: contrato.contaId,
      contratoId: contrato.id,
      type: 'SIGNATURE_ACCEPTED',
      ip: input.ip ?? null,
      userAgent,
      payload: {
        aceite: true,
        acceptanceText: CONTRACT_ACCEPTANCE_TEXT_V1,
        acceptanceVersion: CONTRACT_ACCEPTANCE_VERSION,
        acceptedAt: now.toISOString(),
        payloadHash: signatureHash,
      },
    });

    const updated = await tx.contrato.updateMany({
      where: { id: contrato.id, contaId: contrato.contaId, status: 'PENDENTE' },
      data: {
        status: 'ASSINADO',
        assinadoPor: signer.signer.nome,
        assinadoCpf: signer.signer.cpf,
        assinadoEmail: input.email || null,
        assinadoIp: input.ip ?? null,
        assinadoUserAgent: userAgent,
        assinadoEm: now,
        hashAssinatura: signatureHash,
        arquivoPdfAssinadoUrl: signedPdfUrl,
        hashPdfAssinado: signedPdf.hashSha256,
      },
    });

    if (updated.count !== 1) {
      throw new Error('CONTRACT_ALREADY_SIGNED');
    }

    await tx.contratoDocumento.create({
      data: {
        contaId: contrato.contaId,
        contratoId: contrato.id,
        tipo: 'ASSINADO',
        arquivoUrl: signedPdf.dataUrl,
        hashSha256: signedPdf.hashSha256,
        tamanhoBytes: signedPdf.tamanhoBytes,
        mimeType: 'application/pdf',
      },
    });

    await tx.contratoDocumento.create({
      data: {
        contaId: contrato.contaId,
        contratoId: contrato.id,
        tipo: 'CERTIFICADO_EVIDENCIAS',
        arquivoUrl: signedPdf.dataUrl,
        hashSha256: signedPdf.hashSha256,
        tamanhoBytes: signedPdf.tamanhoBytes,
        mimeType: 'application/pdf',
      },
    });

    await createContractEvidence(tx as never, {
      contaId: contrato.contaId,
      contratoId: contrato.id,
      type: 'SIGNED_PDF_GENERATED',
      ip: input.ip ?? null,
      userAgent,
      payload: {
        arquivoUrl: signedPdfUrl,
        hashPdfOriginal: contrato.hashPdf,
        hashPdfAssinado: signedPdf.hashSha256,
        tamanhoBytes: signedPdf.tamanhoBytes,
      } as Prisma.InputJsonObject,
    });

    await createContractEvidence(tx as never, {
      contaId: contrato.contaId,
      contratoId: contrato.id,
      type: 'SIGNATURE_COMPLETED',
      ip: input.ip ?? null,
      userAgent,
      payload: {
        signatureHash,
        signedPdfHash: signedPdf.hashSha256,
        signerType: signer.signer.type,
      },
    });

    await tx.matricula.update({
      where: { id: contrato.matriculaId },
      data: {
        statusContrato: 'ATIVO',
        contratoAtualId: contrato.id,
      },
    });
  });

  return {
    success: true,
    hash: signatureHash,
    signedPdfHash: signedPdf.hashSha256,
    signedPdfUrl,
    contaId: contrato.contaId,
    contratoId: contrato.id,
    matriculaId: contrato.matriculaId,
    alunoNome: contrato.matricula.aluno.nome ?? 'Aluno',
    assinadoPor: signer.signer.nome,
  };
}
