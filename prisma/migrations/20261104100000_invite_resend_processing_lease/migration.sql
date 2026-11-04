BEGIN;

ALTER TABLE "InviteResendRequest"
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

COMMIT;
