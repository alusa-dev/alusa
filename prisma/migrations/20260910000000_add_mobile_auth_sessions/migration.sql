CREATE TABLE "MobileAuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceId" TEXT,
    "deviceName" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MobileAuthSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MobileAuthSession_tokenHash_key" ON "MobileAuthSession"("tokenHash");
CREATE INDEX "idx_mobile_auth_session_user_active" ON "MobileAuthSession"("userId", "revokedAt", "expiresAt");
CREATE INDEX "idx_mobile_auth_session_expires" ON "MobileAuthSession"("expiresAt");

ALTER TABLE "MobileAuthSession"
ADD CONSTRAINT "MobileAuthSession_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
