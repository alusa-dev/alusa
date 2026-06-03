import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  contratoPublicTokenParamsDTOSchema,
  publicAssinarContratoInputDTOSchema,
  publicAssinarContratoResultDTOSchema,
} from '@/features/contratos/dtos';
import { jsonSensitive } from '@/lib/http-security';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';
import { createContractSignedNotification, signPublicContract } from '@alusa/lib';

function statusForDomainError(error: Error) {
  switch (error.message) {
    case 'CONTRACT_NOT_FOUND':
      return { status: 404, message: 'Contrato não encontrado' };
    case 'CONTRACT_ALREADY_SIGNED':
      return { status: 400, message: 'Contrato já assinado' };
    case 'CONTRACT_CANCELLED':
      return { status: 400, message: 'Contrato cancelado' };
    case 'CONTRACT_EXPIRED':
    case 'CONTRACT_LINK_EXPIRED':
      return { status: 400, message: 'Link expirado' };
    case 'UNDERAGE_STUDENT':
      return { status: 403, message: 'Aluno menor de idade não pode assinar o contrato' };
    case 'MISSING_BIRTHDATE':
      return { status: 403, message: 'Não foi possível validar a maioridade do aluno' };
    case 'INVALID_CPF':
      return { status: 400, message: 'CPF inválido' };
    case 'NOT_AUTHORIZED':
      return {
        status: 403,
        message: 'CPF não corresponde ao responsável ou aluno maior de idade autorizado',
      };
    case 'SIGNED_PDF_SOURCE_UNAVAILABLE':
      return {
        status: 500,
        message: 'Não foi possível carregar o PDF original para gerar a versão assinada',
      };
    default:
      return null;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const rawParams = await params;
    const { token } = contratoPublicTokenParamsDTOSchema.parse(rawParams);
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
    const userAgent = body.userAgent || request.headers.get('user-agent') || null;

    const result = await signPublicContract({
      token,
      cpf: body.cpf,
      nome: body.nome,
      email: body.email || null,
      aceite: body.aceite,
      ip: clientIp,
      userAgent,
      baseUrl: request.nextUrl.origin,
    });

    void createContractSignedNotification({
      contaId: result.contaId,
      contratoId: result.contratoId,
      matriculaId: result.matriculaId,
      alunoNome: result.alunoNome,
      assinadoPor: result.assinadoPor,
    });

    return jsonSensitive(
      publicAssinarContratoResultDTOSchema.parse({
        success: true,
        hash: result.hash,
        signedPdfHash: result.signedPdfHash,
        signedPdfUrl: result.signedPdfUrl,
      }),
    );
  } catch (error) {
    console.error('[PUBLIC_CONTRATO_ASSINAR]', error);
    if (error instanceof z.ZodError) {
      return jsonSensitive(
        { error: { message: 'Dados inválidos', details: error.errors } },
        { status: 400 },
      );
    }

    if (error instanceof Error) {
      const mapped = statusForDomainError(error);
      if (mapped) {
        return jsonSensitive({ error: { message: mapped.message } }, { status: mapped.status });
      }
    }

    return jsonSensitive(
      { error: { message: 'Erro ao assinar contrato' } },
      { status: 500 },
    );
  }
}
