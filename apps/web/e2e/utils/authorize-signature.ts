import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

import type { SeedContratoPublicoResult } from './seed-contratos';

/** Creates a valid OTP authorization without depending on an external email provider. */
export async function authorizeSeededContractSignature(
  prisma: PrismaClient,
  seed: SeedContratoPublicoResult,
  input?: { cpf?: string; name?: string; email?: string },
) {
  const contract = await prisma.contrato.findUniqueOrThrow({
    where: { tokenPublico: seed.token },
    select: {
      id: true,
      contaId: true,
      hashPdf: true,
      conta: { select: { nome: true } },
    },
  });
  const cpf = input?.cpf ?? seed.responsavelCpfDigits ?? seed.alunoCpfDigits;
  const name = input?.name ?? (seed.responsavelCpfDigits ? 'Responsável E2E' : 'Aluno E2E');
  const email = input?.email ?? (seed.responsavelCpfDigits ? seed.responsavelEmail : seed.alunoEmail);

  if (!email) throw new Error('E2E signer email is required');

  // Keep this fixture independent from the aggregated @alusa/lib package. The
  // package is ESM-facing while its database export is CommonJS in the E2E
  // Node runner, which makes named-export interop fail before Playwright starts.
  // These operations intentionally mirror the production OTP use case: the
  // code is never persisted, only its HMAC; verification is single-use and
  // atomically records the verification token hash.
  const secret = process.env.SIGNATURE_OTP_SECRET ?? process.env.NEXTAUTH_SECRET ?? 'test-signature-otp-secret';
  const hash = (value: string) => createHmac('sha256', secret).update(value).digest('hex');
  const normalizedCpf = cpf.replace(/\D/g, '');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);

  await prisma.contractSignatureOtp.updateMany({
    where: {
      contaId: contract.contaId,
      contratoId: contract.id,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: { expiresAt: now },
  });

  const otp = await prisma.contractSignatureOtp.create({
    data: {
      contaId: contract.contaId,
      contratoId: contract.id,
      eventoContratoId: null,
      cpf: normalizedCpf,
      emailSnapshot: email.trim().toLowerCase(),
      contractHash: contract.hashPdf,
      codeHash: hash(code),
      requestedIp: '203.0.113.10',
      requestedUserAgent: 'playwright',
      expiresAt,
    },
  });

  const storedHash = Buffer.from(otp.codeHash, 'hex');
  const providedHash = Buffer.from(hash(code), 'hex');
  if (storedHash.length !== providedHash.length || !timingSafeEqual(storedHash, providedHash)) {
    throw new Error('E2E OTP fixture could not verify its generated code');
  }

  const verificationToken = randomBytes(32).toString('base64url');
  const updated = await prisma.contractSignatureOtp.updateMany({
    where: {
      id: otp.id,
      contaId: contract.contaId,
      contratoId: contract.id,
      consumedAt: null,
      verifiedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: {
      verifiedAt: new Date(),
      verificationTokenHash: hash(verificationToken),
    },
  });

  if (updated.count !== 1) throw new Error('E2E OTP fixture could not authorize the contract');
  return { verificationToken, otpId: otp.id, expiresAt, cpf, name, email };
}
