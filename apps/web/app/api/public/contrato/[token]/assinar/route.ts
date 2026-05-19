
import { NextRequest } from 'next/server';
import { prisma } from '@/prisma/client';
import { z } from 'zod';
import crypto from 'crypto';
import {
  contratoPublicTokenParamsDTOSchema,
  publicAssinarContratoInputDTOSchema,
  publicAssinarContratoResultDTOSchema,
} from '@/features/contratos/dtos';
import { jsonSensitive } from '@/lib/http-security';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';
import { createContractSignedNotification } from '@alusa/lib';

export function isMaiorDeIdade(dataNasc: Date, referencia = new Date()): boolean {
  const yearDiff = referencia.getFullYear() - dataNasc.getFullYear();
  if (yearDiff > 18) return true;
  if (yearDiff < 18) return false;

  const monthDiff = referencia.getMonth() - dataNasc.getMonth();
  if (monthDiff > 0) return true;
  if (monthDiff < 0) return false;

  return referencia.getDate() >= dataNasc.getDate();
}

export function buildAssinaturaHashPayload(input: {
  contratoId: string;
  hashPdf: string;
  cpf: string; // digits
  nome: string;
  email?: string;
  assinadoEmIso: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  return {
    v: 1,
    contratoId: input.contratoId,
    assinadoEm: input.assinadoEmIso,
    cpf: input.cpf,
    nome: input.nome,
    email: input.email || null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    hashPdf: input.hashPdf,
  };
}

function sanitizeUserAgent(value: string | undefined) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 512);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
    const rawParams = await params;
  const { token } = contratoPublicTokenParamsDTOSchema.parse(params);

  try {
    const clientIp = ipFromRequest(request);
    const limiter = rateLimit(`public-contract-sign:${token}:${clientIp}`, 8, 15 * 60 * 1000);
    if (!limiter.ok) {
      return jsonSensitive(
        { error: { message: 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.' } },
        { status: 429 },
      );
    }

    const json = await request.json();
    const body = publicAssinarContratoInputDTOSchema.parse(json);

    // Buscar contrato
    const contrato = await prisma.contrato.findUnique({
      where: { tokenPublico: token },
      include: {
        matricula: {
          select: {
            id: true,
            aluno: {
              select: { nome: true, cpf: true, dataNasc: true, contaId: true },
            },
            responsavelFinanceiro: { select: { nome: true, cpf: true } },
          },
        },
      },
    });

    if (!contrato) {
      return jsonSensitive({ error: { message: 'Contrato não encontrado' } }, { status: 404 });
    }

    if (contrato.status === 'ASSINADO') {
      return jsonSensitive({ error: { message: 'Contrato já assinado' } }, { status: 400 });
    }

    if (contrato.status === 'CANCELADO') {
      return jsonSensitive({ error: { message: 'Contrato cancelado' } }, { status: 400 });
    }

    if (contrato.tokenExpiraEm && new Date() > contrato.tokenExpiraEm) {
      return jsonSensitive({ error: { message: 'Link expirado' } }, { status: 400 });
    }

    // CPF já vem normalizado (digits) pelo schema
    const cpfLimpo = body.cpf;
    const cpfResponsavel = contrato.matricula.responsavelFinanceiro?.cpf?.replace(/\D/g, '');
    const cpfAluno = contrato.matricula.aluno.cpf?.replace(/\D/g, '');

    // Validação de quem pode assinar
    // 1. Responsável financeiro
    // 2. Aluno maior de 18 anos
    let signerName: string | null = null;

    if (cpfResponsavel && cpfLimpo === cpfResponsavel) {
      signerName = contrato.matricula.responsavelFinanceiro?.nome ?? null;
    } else if (cpfAluno && cpfLimpo === cpfAluno) {
      if (!contrato.matricula.aluno.dataNasc) {
        return jsonSensitive(
          { error: { message: 'Não foi possível validar a maioridade do aluno' } },
          { status: 403 },
        );
      }

      const nasc = new Date(contrato.matricula.aluno.dataNasc);
      if (isMaiorDeIdade(nasc)) {
        signerName = contrato.matricula.aluno.nome;
      } else {
        return jsonSensitive(
          { error: { message: 'Aluno menor de idade não pode assinar o contrato' } },
          { status: 403 },
        );
      }
    }

    if (!signerName) {
      return jsonSensitive(
        { error: { message: 'CPF não corresponde ao responsável ou aluno maior de idade autorizado' } },
        { status: 403 },
      );
    }

    const canonicalSignerName = signerName.trim();
    if (!canonicalSignerName) {
      return jsonSensitive(
        { error: { message: 'Não foi possível identificar o titular autorizado para assinatura.' } },
        { status: 403 },
      );
    }

    const assinadoEm = new Date();
    const userAgent = sanitizeUserAgent(body.userAgent);
    const payload = buildAssinaturaHashPayload({
      contratoId: contrato.id,
      hashPdf: contrato.hashPdf,
      cpf: cpfLimpo,
      nome: canonicalSignerName,
      email: body.email,
      assinadoEmIso: assinadoEm.toISOString(),
      ip: clientIp,
      userAgent,
    });
    const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

    // TODO: Disparar geração de PDF (pode ser async ou sob demanda)
    // Por enquanto, o status ASSINADO já permite gerar o PDF na visualização

    await prisma.$transaction(async (tx) => {
      const updated = await tx.contrato.updateMany({
        where: { id: contrato.id, status: 'PENDENTE' },
        data: {
          status: 'ASSINADO',
          assinadoPor: canonicalSignerName,
          assinadoCpf: cpfLimpo,
          assinadoEmail: body.email,
          assinadoIp: clientIp,
          assinadoUserAgent: userAgent,
          assinadoEm,
          hashAssinatura: hash,
        },
      });

      if (updated.count !== 1) {
        throw new Error('Contrato já assinado');
      }

      await tx.matricula.update({
        where: { id: contrato.matriculaId },
        data: {
          statusContrato: 'ATIVO',
          contratoAtualId: contrato.id,
        },
      });
    });

    void createContractSignedNotification({
      contaId: contrato.matricula.aluno.contaId,
      contratoId: contrato.id,
      matriculaId: contrato.matricula.id,
      alunoNome: contrato.matricula.aluno.nome ?? 'Aluno',
      assinadoPor: canonicalSignerName,
    });

    return jsonSensitive(publicAssinarContratoResultDTOSchema.parse({ success: true, hash }));
  } catch (error) {
    console.error('[PUBLIC_CONTRATO_ASSINAR]', error);
    if (error instanceof Error && error.message === 'Contrato já assinado') {
      return jsonSensitive({ error: { message: 'Contrato já assinado' } }, { status: 400 });
    }
    if (error instanceof z.ZodError) {
      return jsonSensitive(
        { error: { message: 'Dados inválidos', details: error.errors } },
        { status: 400 },
      );
    }
    return jsonSensitive(
      { error: { message: 'Erro ao assinar contrato' } },
      { status: 500 },
    );
  }
}
