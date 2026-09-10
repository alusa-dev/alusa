-- Desafio OTP de troca de senha: códigos e tokens de verificação são persistidos
-- somente em formato hash e ficam vinculados ao usuário e à conta.
CREATE TYPE "PasswordChangeOtpChannel" AS ENUM ('EMAIL', 'WHATSAPP');

CREATE TABLE "PasswordChangeOtp" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "channel" "PasswordChangeOtpChannel" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "verificationTokenHash" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resendAvailableAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "verificationExpiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "requestedByIp" TEXT,
    "requestedByUserAgent" TEXT,
    "emailSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PasswordChangeOtp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_password_change_otp_user_created" ON "PasswordChangeOtp"("userId", "createdAt");
CREATE INDEX "idx_password_change_otp_conta_user_created" ON "PasswordChangeOtp"("contaId", "userId", "createdAt");
CREATE INDEX "idx_password_change_otp_expires" ON "PasswordChangeOtp"("expiresAt");

ALTER TABLE "PasswordChangeOtp" ADD CONSTRAINT "PasswordChangeOtp_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PasswordChangeOtp" ADD CONSTRAINT "PasswordChangeOtp_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
