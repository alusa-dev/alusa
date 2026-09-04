import { NextRequest } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  findPublicEventContractByToken,
  prisma,
  verifyPublicContractSignatureOtp,
} from '@alusa/lib';
import { hashCanonicalPayload } from '@alusa/domain';
import { jsonSensitive } from '@/lib/http-security';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';
import { publicVerificarAssinaturaOtpInputDTOSchema } from '@/features/contratos/dtos';

function mapError(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  const map: Record<string, { status: number; message: string }> = {
    CONTRACT_NOT_FOUND: { status: 404, message: 'Contrato não encontrado' },
    CONTRACT_ALREADY_SIGNED: { status: 400, message: 'Contrato já assinado' },
    CONTRACT_CANCELLED: { status: 400, message: 'Contrato cancelado' },
    CONTRACT_EXPIRED: { status: 400, message: 'Contrato expirado' },
    CONTRACT_LINK_EXPIRED: { status: 400, message: 'Link expirado' },
    SIGNATURE_OTP_INVALID: { status: 400, message: 'Código inválido. Confira os números e tente novamente.' },
    SIGNATURE_OTP_EXPIRED: { status: 400, message: 'Este código expirou. Solicite um novo código.' },
    SIGNATURE_OTP_TOO_MANY_ATTEMPTS: { status: 429, message: 'Limite de tentativas atingido. Solicite um novo código.' },
    SIGNATURE_OTP_ALREADY_VERIFIED: { status: 409, message: 'Este código já foi confirmado.' },
  };
  return map[code] ?? { status: 500, message: 'Não foi possível confirmar o código' };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const clientIp = ipFromRequest(request);
  try {
    const { token } = await params;
    const limiter = rateLimit(`public-event-contract-signature-otp-verify:${token}:${clientIp}`, 8, 15 * 60 * 1000);
    if (!limiter.ok) return jsonSensitive({ error: { message: 'Muitas tentativas. Aguarde alguns minutos.' } }, { status: 429 });
    const body = publicVerificarAssinaturaOtpInputDTOSchema.parse(await request.json());
    const contract = await findPublicEventContractByToken(token);
    if (!contract) throw new Error('CONTRACT_NOT_FOUND');
    if (contract.status === 'ASSINADO') throw new Error('CONTRACT_ALREADY_SIGNED');
    if (contract.status === 'CANCELADO') throw new Error('CONTRACT_CANCELLED');
    if (contract.status === 'EXPIRADO') throw new Error('CONTRACT_EXPIRED');
    if (contract.tokenExpiraEm && new Date() > contract.tokenExpiraEm) throw new Error('CONTRACT_LINK_EXPIRED');

    let result;
    try {
      result = await verifyPublicContractSignatureOtp({ contaId: contract.contaId, eventoContratoId: contract.id, cpf: body.cpf, code: body.code, contractHash: contract.hashPdf });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'SIGNATURE_OTP_FAILED';
      const failurePayload: Prisma.InputJsonValue = { reason };
      await prisma.eventoContratoEvidence.create({ data: { contaId: contract.contaId, eventoContratoId: contract.id, type: reason === 'SIGNATURE_OTP_EXPIRED' ? 'SIGNATURE_OTP_EXPIRED' : 'SIGNATURE_OTP_FAILED', actorType: 'PUBLIC', ip: clientIp, userAgent: request.headers.get('user-agent'), payload: failurePayload, payloadHash: hashCanonicalPayload(failurePayload) } }).catch(() => undefined);
      throw error;
    }
    const payload: Prisma.InputJsonValue = { otpId: result.otpId };
    await prisma.eventoContratoEvidence.create({ data: { contaId: contract.contaId, eventoContratoId: contract.id, type: 'SIGNATURE_OTP_VERIFIED', actorType: 'PUBLIC', ip: clientIp, userAgent: request.headers.get('user-agent'), payload, payloadHash: hashCanonicalPayload(payload) } });
    return jsonSensitive({ success: true, verificationToken: result.verificationToken });
  } catch (error) {
    if (error instanceof z.ZodError) return jsonSensitive({ error: { message: 'Código inválido' } }, { status: 400 });
    const mapped = mapError(error);
    return jsonSensitive({ error: { message: mapped.message } }, { status: mapped.status });
  }
}
