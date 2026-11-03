import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '@/lib/prisma';
import { PasswordChangeOtpError, verifyPasswordChangeOtp } from '@/lib/password-change-otp';

const contaAId = 'otp-membership-school-a';
const contaBId = 'otp-membership-school-b';
const userId = 'otp-membership-user';
const challengeId = 'otp-membership-challenge-a';
const email = 'otp-membership-user@example.test';
const code = '314159';
const previousSecret = process.env.NEXTAUTH_SECRET;

function codeHash() {
  return createHmac('sha256', process.env.NEXTAUTH_SECRET!)
    .update(`password-change-code:${challengeId}:${code}`)
    .digest('hex');
}

async function cleanup() {
  await prisma.passwordChangeOtp.deleteMany({ where: { id: challengeId } });
  await prisma.usuarioConta.deleteMany({ where: { usuarioId: userId } });
  await prisma.usuario.deleteMany({ where: { id: userId } });
}

describe('password change OTP tenant membership', () => {
  beforeAll(async () => {
    process.env.NEXTAUTH_SECRET = 'otp-membership-test-secret';
    await cleanup();
    await Promise.all([contaAId, contaBId].map((id) => prisma.conta.upsert({
      where: { id }, update: { status: 'ATIVO' }, create: { id, nome: id, status: 'ATIVO' },
    })));
    await prisma.usuario.create({
      data: {
        id: userId, contaId: null, nome: 'OTP multi-school user', email,
        senhaHash: 'unchanged-password-hash', status: 'ATIVO', sessionVersion: 0,
      },
    });
    await prisma.usuarioConta.createMany({
      data: [contaAId, contaBId].map((contaId) => ({ usuarioId: userId, contaId, role: 'RESPONSAVEL' as const, status: 'ATIVO' as const })),
    });
    await prisma.passwordChangeOtp.create({
      data: {
        id: challengeId, userId, contaId: contaAId, channel: 'EMAIL', codeHash: codeHash(),
        expiresAt: new Date(Date.now() + 5 * 60_000),
        resendAvailableAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await cleanup();
    if (previousSecret === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = previousSecret;
  });

  it('accepts a challenge in school A, rejects the same challenge in B, and leaves the password unchanged', async () => {
    await expect(verifyPasswordChangeOtp({ userId, contaId: contaAId, challengeId, code }))
      .resolves.toMatchObject({ verificationToken: expect.any(String) });
    await expect(verifyPasswordChangeOtp({ userId, contaId: contaBId, challengeId, code }))
      .rejects.toMatchObject({ code: 'CHALLENGE_NOT_FOUND' } satisfies Partial<PasswordChangeOtpError>);

    await expect(prisma.usuario.findUnique({ where: { id: userId }, select: { senhaHash: true } }))
      .resolves.toEqual({ senhaHash: 'unchanged-password-hash' });
    await expect(prisma.usuarioConta.count({ where: { usuarioId: userId, contaId: contaBId, status: 'ATIVO' } }))
      .resolves.toBe(1);
  });
});
