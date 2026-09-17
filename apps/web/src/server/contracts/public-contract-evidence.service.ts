import { prisma } from '@/prisma/client';
import type { Prisma } from '@prisma/client';
import { hashCanonicalPayload } from '@alusa/domain';
import { createContractEvidence } from '@alusa/lib/contracts/evidence/create-contract-evidence';
import { verifyPublicContractSignatureOtp } from '@alusa/lib/contracts/use-cases/signature-otp';

export async function recordPublicContractEvidence(input: {
  contaId: string;
  contratoId: string;
  type: Parameters<typeof createContractEvidence>[1]['type'];
  actorType?: string | null;
  actorId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  payload: Prisma.InputJsonValue;
}) {
  return createContractEvidence(prisma as never, input);
}

export async function recordPublicEventContractEvidence(input: {
  contaId: string;
  eventoContratoId: string;
  type: 'PUBLIC_LINK_OPENED' | 'SIGNATURE_OTP_REQUESTED' | 'SIGNATURE_OTP_SENT' | 'SIGNATURE_OTP_FAILED' | 'SIGNATURE_OTP_VERIFIED' | 'SIGNATURE_OTP_EXPIRED';
  ip?: string | null;
  userAgent?: string | null;
  payload: Prisma.InputJsonValue;
}) {
  await prisma.eventoContratoEvidence.create({
    data: {
      contaId: input.contaId,
      eventoContratoId: input.eventoContratoId,
      type: input.type,
      actorType: 'PUBLIC',
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      payload: input.payload,
      payloadHash: hashCanonicalPayload(input.payload),
    },
  });
}

export async function verifyPublicContractOtpWithEvidence(input: {
  contaId: string;
  contratoId: string;
  cpf: string;
  code: string;
  contractHash: string;
  ip: string | null;
  userAgent: string | null;
}) {
  try {
    return await prisma.$transaction(async (tx) => {
      const verified = await verifyPublicContractSignatureOtp({
        contaId: input.contaId,
        contratoId: input.contratoId,
        cpf: input.cpf,
        code: input.code,
        contractHash: input.contractHash,
        db: tx,
      });
      await createContractEvidence(tx as never, {
        contaId: input.contaId,
        contratoId: input.contratoId,
        type: 'SIGNATURE_OTP_VERIFIED',
        actorType: 'PUBLIC',
        ip: input.ip,
        userAgent: input.userAgent,
        payload: { otpId: verified.otpId },
      });
      return verified;
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'SIGNATURE_OTP_FAILED';
    await recordPublicContractEvidence({
      contaId: input.contaId,
      contratoId: input.contratoId,
      type: reason === 'SIGNATURE_OTP_EXPIRED' ? 'SIGNATURE_OTP_EXPIRED' : 'SIGNATURE_OTP_FAILED',
      ip: input.ip,
      userAgent: input.userAgent,
      payload: { reason },
    }).catch(() => undefined);
    throw error;
  }
}

export async function verifyPublicEventContractOtpWithEvidence(input: {
  contaId: string;
  eventoContratoId: string;
  cpf: string;
  code: string;
  contractHash: string;
  ip: string | null;
  userAgent: string | null;
}) {
  try {
    return await prisma.$transaction(async (tx) => {
      const verified = await verifyPublicContractSignatureOtp({
        contaId: input.contaId,
        eventoContratoId: input.eventoContratoId,
        cpf: input.cpf,
        code: input.code,
        contractHash: input.contractHash,
        db: tx,
      });
      const payload: Prisma.InputJsonValue = { otpId: verified.otpId };
      await tx.eventoContratoEvidence.create({
        data: {
          contaId: input.contaId,
          eventoContratoId: input.eventoContratoId,
          type: 'SIGNATURE_OTP_VERIFIED',
          actorType: 'PUBLIC',
          ip: input.ip,
          userAgent: input.userAgent,
          payload,
          payloadHash: hashCanonicalPayload(payload),
        },
      });
      return verified;
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'SIGNATURE_OTP_FAILED';
    await recordPublicEventContractEvidence({
      contaId: input.contaId,
      eventoContratoId: input.eventoContratoId,
      type: reason === 'SIGNATURE_OTP_EXPIRED' ? 'SIGNATURE_OTP_EXPIRED' : 'SIGNATURE_OTP_FAILED',
      ip: input.ip,
      userAgent: input.userAgent,
      payload: { reason },
    }).catch(() => undefined);
    throw error;
  }
}
