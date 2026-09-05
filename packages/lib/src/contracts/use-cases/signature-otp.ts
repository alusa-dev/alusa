import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { normalizeCpf } from '@alusa/domain';
import { prisma } from '../../prisma';

type OtpDb = Pick<PrismaClient, 'contractSignatureOtp'> | Pick<Prisma.TransactionClient, 'contractSignatureOtp'>;

export type PublicContractSignatureOtpTarget = {
  contaId: string;
  contratoId?: string;
  eventoContratoId?: string;
  cpf: string;
  email: string;
  contractHash: string;
  recipientName: string;
  schoolName: string;
  contractReference: string;
  requestedIp?: string | null;
  requestedUserAgent?: string | null;
};

export type CreatedSignatureOtp = {
  id: string;
  code: string;
  expiresAt: Date;
  email: string;
  recipientName: string;
  schoolName: string;
  contractReference: string;
};

function otpSecret(): string {
  const secret = process.env.SIGNATURE_OTP_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') throw new Error('SIGNATURE_OTP_SECRET_MISSING');
  return 'alusa-development-signature-otp-secret';
}

function hashOtpValue(value: string): string {
  return createHmac('sha256', otpSecret()).update(value).digest('hex');
}

function resourceWhere(input: { contratoId?: string; eventoContratoId?: string }) {
  if (input.contratoId) return { contratoId: input.contratoId };
  if (input.eventoContratoId) return { eventoContratoId: input.eventoContratoId };
  throw new Error('SIGNATURE_OTP_RESOURCE_MISSING');
}

function compareHash(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'hex');
  const providedBuffer = Buffer.from(provided, 'hex');
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function createPublicContractSignatureOtp(
  input: PublicContractSignatureOtpTarget,
): Promise<CreatedSignatureOtp> {
  const cpf = normalizeCpf(input.cpf);
  const email = input.email.trim().toLowerCase();
  if (!email) throw new Error('SIGNATURE_OTP_EMAIL_MISSING');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
  const resource = resourceWhere(input);

  const record = await prisma.$transaction(async (tx) => {
    await tx.contractSignatureOtp.updateMany({
      where: {
        contaId: input.contaId,
        ...resource,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { expiresAt: now },
    });

    return tx.contractSignatureOtp.create({
      data: {
        contaId: input.contaId,
        contratoId: input.contratoId ?? null,
        eventoContratoId: input.eventoContratoId ?? null,
        cpf,
        emailSnapshot: email,
        contractHash: input.contractHash,
        codeHash: hashOtpValue(code),
        requestedIp: input.requestedIp ?? null,
        requestedUserAgent: input.requestedUserAgent ?? null,
        expiresAt,
      },
    });
  });

  return {
    id: record.id,
    code,
    expiresAt,
    email,
    recipientName: input.recipientName,
    schoolName: input.schoolName,
    contractReference: input.contractReference,
  };
}

export async function setPublicContractSignatureOtpMetadata(input: {
  id: string;
  requestedIp?: string | null;
  requestedUserAgent?: string | null;
  emailSent?: boolean;
}) {
  await prisma.contractSignatureOtp.update({
    where: { id: input.id },
    data: {
      ...(input.requestedIp !== undefined ? { requestedIp: input.requestedIp } : {}),
      ...(input.requestedUserAgent !== undefined ? { requestedUserAgent: input.requestedUserAgent } : {}),
      ...(input.emailSent ? { emailSentAt: new Date() } : {}),
    },
  });
}

export async function verifyPublicContractSignatureOtp(input: {
  contaId: string;
  contratoId?: string;
  eventoContratoId?: string;
  cpf: string;
  code: string;
  contractHash: string;
  db?: OtpDb;
}): Promise<{ verificationToken: string; otpId: string; expiresAt: Date }> {
  const cpf = normalizeCpf(input.cpf);
  const now = new Date();
  const resource = resourceWhere(input);
  const db = input.db ?? prisma;
  const otp = await db.contractSignatureOtp.findFirst({
    where: {
      contaId: input.contaId,
      cpf,
      contractHash: input.contractHash,
      ...resource,
      consumedAt: null,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!otp) throw new Error('SIGNATURE_OTP_INVALID');
  if (otp.expiresAt <= now) throw new Error('SIGNATURE_OTP_EXPIRED');
  if (otp.attempts >= otp.maxAttempts) throw new Error('SIGNATURE_OTP_TOO_MANY_ATTEMPTS');
  if (!compareHash(otp.codeHash, hashOtpValue(input.code))) {
    await prisma.contractSignatureOtp.updateMany({
      where: { id: otp.id, attempts: { lt: otp.maxAttempts }, consumedAt: null },
      data: { attempts: { increment: 1 } },
    });
    throw new Error('SIGNATURE_OTP_INVALID');
  }

  const verificationToken = randomBytes(32).toString('base64url');
  const updated = await db.contractSignatureOtp.updateMany({
    where: {
      id: otp.id,
      contaId: input.contaId,
      consumedAt: null,
      verifiedAt: null,
      expiresAt: { gt: now },
    },
    data: {
      verifiedAt: now,
      verificationTokenHash: hashOtpValue(verificationToken),
    },
  });

  if (updated.count !== 1) throw new Error('SIGNATURE_OTP_ALREADY_VERIFIED');
  return { verificationToken, otpId: otp.id, expiresAt: otp.expiresAt };
}

export async function getPublicContractSignatureOtpAuthorization(input: {
  contaId: string;
  contratoId?: string;
  eventoContratoId?: string;
  cpf: string;
  contractHash: string;
  verificationToken: string;
}) {
  const otp = await prisma.contractSignatureOtp.findFirst({
    where: {
      contaId: input.contaId,
      cpf: normalizeCpf(input.cpf),
      contractHash: input.contractHash,
      verificationTokenHash: hashOtpValue(input.verificationToken),
      ...resourceWhere(input),
      verifiedAt: { not: null },
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true, emailSnapshot: true },
  });

  if (!otp) throw new Error('SIGNATURE_OTP_NOT_VERIFIED');
  return otp;
}

export async function consumePublicContractSignatureOtp(
  db: OtpDb,
  input: {
    contaId: string;
    contratoId?: string;
    eventoContratoId?: string;
    cpf: string;
    contractHash: string;
    verificationToken: string;
  },
) {
  const now = new Date();
  const updated = await db.contractSignatureOtp.updateMany({
    where: {
      contaId: input.contaId,
      cpf: normalizeCpf(input.cpf),
      contractHash: input.contractHash,
      verificationTokenHash: hashOtpValue(input.verificationToken),
      ...resourceWhere(input),
      verifiedAt: { not: null },
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: { consumedAt: now },
  });

  if (updated.count !== 1) throw new Error('SIGNATURE_OTP_NOT_VERIFIED');
}
