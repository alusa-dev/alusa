import { NextRequest } from 'next/server';
import { z } from 'zod';
import { findPublicEventContractByToken } from '@alusa/lib/events/event-contracts.service';
import { jsonSensitive } from '@/lib/http-security';
import { ipFromRequest, strictRateLimitAsync } from '@/lib/rate-limit';
import { publicVerificarAssinaturaOtpInputDTOSchema } from '@/features/contratos/dtos';
import { verifyPublicEventContractOtpWithEvidence } from '@/src/server/contracts/public-contract-evidence.service';

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
    const limiter = await strictRateLimitAsync(`public-event-contract-signature-otp-verify:${token}:${clientIp}`, 8, 15 * 60 * 1000);
    if (!limiter.ok) return jsonSensitive({ error: { message: 'Muitas tentativas. Aguarde alguns minutos.' } }, { status: 429 });
    const body = publicVerificarAssinaturaOtpInputDTOSchema.parse(await request.json());
    const contract = await findPublicEventContractByToken(token);
    if (!contract) throw new Error('CONTRACT_NOT_FOUND');
    if (contract.status === 'ASSINADO') throw new Error('CONTRACT_ALREADY_SIGNED');
    if (contract.status === 'CANCELADO') throw new Error('CONTRACT_CANCELLED');
    if (contract.status === 'EXPIRADO') throw new Error('CONTRACT_EXPIRED');
    if (contract.tokenExpiraEm && new Date() > contract.tokenExpiraEm) throw new Error('CONTRACT_LINK_EXPIRED');

    const result = await verifyPublicEventContractOtpWithEvidence({
      contaId: contract.contaId,
      eventoContratoId: contract.id,
      cpf: body.cpf,
      code: body.code,
      contractHash: contract.hashPdf,
      ip: clientIp,
      userAgent: request.headers.get('user-agent'),
    });
    return jsonSensitive({ success: true, verificationToken: result.verificationToken });
  } catch (error) {
    if (error instanceof z.ZodError) return jsonSensitive({ error: { message: 'Código inválido' } }, { status: 400 });
    const mapped = mapError(error);
    return jsonSensitive({ error: { message: mapped.message } }, { status: mapped.status });
  }
}
