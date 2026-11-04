BEGIN;

UPDATE "InviteResendRequest"
SET "leaseExpiresAt" = GREATEST(
  "createdAt" + INTERVAL '10 minutes',
  (NOW() AT TIME ZONE 'UTC') + INTERVAL '10 minutes'
)
WHERE "status" = 'PROCESSING'::"InviteResendRequestStatus"
  AND "leaseExpiresAt" IS NULL;

COMMIT;
