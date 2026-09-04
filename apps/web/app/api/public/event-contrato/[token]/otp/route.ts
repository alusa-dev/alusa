import { NextRequest } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  createPublicContractSignatureOtp,
  findPublicEventContractByToken,
  prisma,
  resolvePublicContractSigner,
  setPublicContractSignatureOtpMetadata,
} from '@alusa/lib';
import { hashCanonicalPayload } from '@alusa/domain';
import { jsonSensitive } from '@/lib/http-security';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';
import { publicSolicitarAssinaturaOtpInputDTOSchema } from '@/features/contratos/dtos';
import { sendContractSignatureOtpEmail } from '@/lib/email/contract-signature-otp-email';

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return 'e-mail cadastrado';
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(2, Math.min(local.length - 1, 5)))}@${domain}`;
}

async function recordOtpEvidence(input: {
  contaId: string;
  eventoContratoId: string;
  type: 'SIGNATURE_OTP_REQUESTED' | 'SIGNATURE_OTP_SENT' | 'SIGNATURE_OTP_FAILED';
  ip: string;
  userAgent: string | null;
  payload: Prisma.InputJsonValue;
}) {
  await prisma.eventoContratoEvidence.create({
    data: {
      contaId: input.contaId,
      eventoContratoId: input.eventoContratoId,
      type: input.type,
      actorType: 'PUBLIC',
      ip: input.ip,
      userAgent: input.userAgent,
      payload: input.payload,
      payloadHash: hashCanonicalPayload(input.payload),
    },
  });
}

function mapError(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  if (code.includes('Invalid `to` field')) {
    return { status: 422, message: 'O e-mail cadastrado não pode receber mensagens de teste. Use um e-mail real para receber o código.' };
  }
  const map: Record<string, { status: number; message: string }> = {
    CONTRACT_NOT_FOUND: { status: 404, message: 'Contrato não encontrado' },
    CONTRACT_ALREADY_SIGNED: { status: 400, message: 'Contrato já assinado' },
    CONTRACT_CANCELLED: { status: 400, message: 'Contrato cancelado' },
    CONTRACT_EXPIRED: { status: 400, message: 'Contrato expirado' },
    CONTRACT_LINK_EXPIRED: { status: 400, message: 'Link expirado' },
    INVALID_CPF: { status: 400, message: 'CPF inválido' },
    UNDERAGE_STUDENT: { status: 403, message: 'Aluno menor de idade não pode assinar o contrato' },
    MISSING_BIRTHDATE: { status: 403, message: 'Não foi possível validar a maioridade do aluno' },
    NOT_AUTHORIZED: { status: 403, message: 'CPF não corresponde ao responsável ou aluno autorizado' },
    SIGNATURE_OTP_EMAIL_MISSING: { status: 422, message: 'Não há e-mail cadastrado para este signatário. Solicite a atualização dos dados à escola.' },
    SIGNATURE_OTP_SECRET_MISSING: { status: 500, message: 'Serviço de assinatura temporariamente indisponível' },
  };
  return map[code] ?? { status: 500, message: 'Não foi possível enviar o código' };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const clientIp = ipFromRequest(request);
  const userAgent = request.headers.get('user-agent');
  try {
    const { token } = await params;
    const limiter = rateLimit(`public-event-contract-signature-otp-request:${token}:${clientIp}`, 3, 15 * 60 * 1000);
    if (!limiter.ok) return jsonSensitive({ error: { message: 'Aguarde alguns minutos antes de solicitar outro código.' } }, { status: 429 });

    const body = publicSolicitarAssinaturaOtpInputDTOSchema.parse(await request.json());
    const contract = await findPublicEventContractByToken(token);
    if (!contract) throw new Error('CONTRACT_NOT_FOUND');
    if (contract.status === 'ASSINADO') throw new Error('CONTRACT_ALREADY_SIGNED');
    if (contract.status === 'CANCELADO') throw new Error('CONTRACT_CANCELLED');
    if (contract.status === 'EXPIRADO') throw new Error('CONTRACT_EXPIRED');
    if (contract.tokenExpiraEm && new Date() > contract.tokenExpiraEm) throw new Error('CONTRACT_LINK_EXPIRED');

    const signer = resolvePublicContractSigner({
      cpf: body.cpf,
      aluno: contract.aluno,
      responsavelFinanceiro: contract.responsavel,
      responsaveis: contract.aluno.responsaveis.map((item) => ({ ...item.responsavel, contaId: item.contaId })),
      contaId: contract.contaId,
    });
    const otp = await createPublicContractSignatureOtp({
      contaId: contract.contaId,
      eventoContratoId: contract.id,
      cpf: signer.signer.cpf,
      email: signer.email,
      contractHash: contract.hashPdf,
      recipientName: signer.signer.nome,
      schoolName: contract.conta.nome,
      contractReference: contract.id.slice(-8).toUpperCase(),
      requestedIp: clientIp,
      requestedUserAgent: userAgent,
    });

    await recordOtpEvidence({ contaId: contract.contaId, eventoContratoId: contract.id, type: 'SIGNATURE_OTP_REQUESTED', ip: clientIp, userAgent, payload: { otpId: otp.id, emailDomain: signer.email.split('@')[1] ?? null } });
    try {
      const delivery = await sendContractSignatureOtpEmail({ to: otp.email, recipientName: otp.recipientName, code: otp.code, expiresIn: '10 minutos', schoolName: otp.schoolName, contractReference: otp.contractReference, idempotencyKey: `event-contract-signature-otp/${otp.id}` });
      await setPublicContractSignatureOtpMetadata({ id: otp.id, emailSent: true });
      await recordOtpEvidence({ contaId: contract.contaId, eventoContratoId: contract.id, type: 'SIGNATURE_OTP_SENT', ip: clientIp, userAgent, payload: { otpId: otp.id, delivery: delivery.delivery, emailId: delivery.emailId } });
    } catch (error) {
      await recordOtpEvidence({ contaId: contract.contaId, eventoContratoId: contract.id, type: 'SIGNATURE_OTP_FAILED', ip: clientIp, userAgent, payload: { otpId: otp.id, reason: error instanceof Error ? error.message : 'EMAIL_SEND_FAILED' } }).catch(() => undefined);
      throw error;
    }

    return jsonSensitive({ success: true, maskedEmail: maskEmail(otp.email), expiresInSeconds: 600 });
  } catch (error) {
    if (error instanceof z.ZodError) return jsonSensitive({ error: { message: 'Dados inválidos' } }, { status: 400 });
    const mapped = mapError(error);
    return jsonSensitive({ error: { message: mapped.message } }, { status: mapped.status });
  }
}
