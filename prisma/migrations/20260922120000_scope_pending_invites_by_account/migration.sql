-- Expired invites are terminal and must not occupy a pending slot.
UPDATE "Invite"
SET "status" = 'EXPIRED', "updatedAt" = NOW()
WHERE "status" = 'PENDING' AND "expiresAt" <= NOW();

-- Keep only the newest pending invite per tenant/email before installing the
-- tenant-scoped constraint. Older duplicates are revoked, never deleted.
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "contaId", LOWER("email")
    ORDER BY "createdAt" DESC, "id" DESC
  ) AS position
  FROM "Invite"
  WHERE "status" = 'PENDING' AND "email" IS NOT NULL AND "contaId" IS NOT NULL
)
UPDATE "Invite" AS invite
SET "status" = 'REVOKED', "updatedAt" = NOW()
FROM ranked
WHERE invite."id" = ranked."id" AND ranked.position > 1;

DROP INDEX IF EXISTS "Invite_pending_lower_email_key";
CREATE UNIQUE INDEX "Invite_pending_tenant_lower_email_key"
ON "Invite" ("contaId", LOWER("email"))
WHERE "status" = 'PENDING' AND "email" IS NOT NULL AND "contaId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_invite_tenant_status_expiry"
ON "Invite" ("contaId", "status", "expiresAt");

-- A single global login may have a distinct responsible profile in each school.
DROP INDEX IF EXISTS "Responsavel_usuarioId_key";
CREATE INDEX IF NOT EXISTS "idx_responsavel_usuario"
ON "Responsavel" ("usuarioId");
