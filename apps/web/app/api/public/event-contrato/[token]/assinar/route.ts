import { NextRequest } from 'next/server';
import { z } from 'zod';
import { signPublicEventContract } from '@alusa/lib';
import { jsonSensitive } from '@/lib/http-security';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';
import { publicAssinarContratoInputDTOSchema, publicAssinarContratoResultDTOSchema } from '@/features/contratos/dtos';

function mapError(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  const map: Record<string, { status: number; message: string }> = {
    CONTRACT_NOT_FOUND: { status: 404, message: 'Contrato não encontrado' },
    CONTRACT_ALREADY_SIGNED: { status: 400, message: 'Contrato já assinado' },
    CONTRACT_CANCELLED: { status: 400, message: 'Contrato cancelado' },
    CONTRACT_EXPIRED: { status: 400, message: 'Link expirado' },
    CONTRACT_LINK_EXPIRED: { status: 400, message: 'Link expirado' },
    UNDERAGE_STUDENT: { status: 403, message: 'Aluno menor de idade não pode assinar o contrato' },
    MISSING_BIRTHDATE: { status: 403, message: 'Não foi possível validar a maioridade do aluno' },
    INVALID_CPF: { status: 400, message: 'CPF inválido' },
    NOT_AUTHORIZED: { status: 403, message: 'CPF não corresponde ao responsável ou aluno maior de idade autorizado' },
    CONTRACT_CONSENT_REQUIRED: { status: 400, message: 'Responda todos os termos de consentimento antes de assinar' },
    CONTRACT_CONSENT_UNKNOWN_TERM: { status: 400, message: 'Dados de consentimento inválidos' },
    CONTRACT_CONSENT_DUPLICATE: { status: 400, message: 'Dados de consentimento inválidos' },
    CONTRACT_CONSENT_INVALID_DECISION: { status: 400, message: 'Dados de consentimento inválidos' },
    SIGNED_PDF_SOURCE_UNAVAILABLE: { status: 500, message: 'Não foi possível carregar o PDF original' },
    SIGNATURE_OTP_NOT_VERIFIED: { status: 403, message: 'Confirme o código enviado por e-mail antes de assinar' },
  };
  return map[code] ?? { status: 500, message: 'Erro ao assinar contrato' };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const limiter = rateLimit(`public-event-contract-sign:${token}:${ipFromRequest(request)}`, 8, 15 * 60 * 1000);
    if (!limiter.ok) return jsonSensitive({ error: { message: 'Muitas tentativas. Aguarde alguns minutos.' } }, { status: 429 });
    const body = publicAssinarContratoInputDTOSchema.parse(await request.json());
    const result = await signPublicEventContract({ ...body, token, ip: ipFromRequest(request), baseUrl: request.nextUrl.origin, userAgent: body.userAgent || request.headers.get('user-agent') });
    return jsonSensitive(publicAssinarContratoResultDTOSchema.parse(result));
  } catch (error) {
    if (error instanceof z.ZodError) return jsonSensitive({ error: { message: 'Dados inválidos' } }, { status: 400 });
    const mapped = mapError(error);
    return jsonSensitive({ error: { message: mapped.message } }, { status: mapped.status });
  }
}
