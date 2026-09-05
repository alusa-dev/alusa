import { createPublicContractSignatureOtp, verifyPublicContractSignatureOtp } from '@alusa/lib';
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

  const otp = await createPublicContractSignatureOtp({
    contaId: contract.contaId,
    contratoId: contract.id,
    cpf,
    email,
    contractHash: contract.hashPdf,
    recipientName: name,
    schoolName: contract.conta.nome,
    contractReference: contract.id.slice(-8).toUpperCase(),
    requestedIp: '203.0.113.10',
    requestedUserAgent: 'playwright',
  });

  const verification = await verifyPublicContractSignatureOtp({
    contaId: contract.contaId,
    contratoId: contract.id,
    cpf,
    code: otp.code,
    contractHash: contract.hashPdf,
  });

  return { ...verification, cpf, name, email };
}
