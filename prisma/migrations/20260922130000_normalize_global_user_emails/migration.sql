-- Email is the global login identity. Refuse ambiguous legacy duplicates rather
-- than merging accounts/passwords automatically.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Usuario"
    GROUP BY LOWER(BTRIM("email"))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot normalize Usuario.email: case-insensitive duplicates exist; reconcile those identities before retrying.';
  END IF;
END $$;

UPDATE "Usuario"
SET "email" = LOWER(BTRIM("email"))
WHERE "email" <> LOWER(BTRIM("email"));

CREATE UNIQUE INDEX IF NOT EXISTS "Usuario_email_lower_key"
ON "Usuario" (LOWER("email"));

-- Bind legacy invitations to their inviter's tenant so list/revoke operations
-- can remain strictly account-scoped.
WITH ranked AS (
  SELECT invite."id", ROW_NUMBER() OVER (
    PARTITION BY COALESCE(invite."contaId", inviter."contaId"), LOWER(invite."email")
    ORDER BY invite."createdAt" DESC, invite."id" DESC
  ) AS position
  FROM "Invite" AS invite
  LEFT JOIN "Usuario" AS inviter ON inviter."id" = invite."invitedById"
  WHERE invite."status" = 'PENDING'
    AND invite."email" IS NOT NULL
    AND COALESCE(invite."contaId", inviter."contaId") IS NOT NULL
)
UPDATE "Invite" AS invite
SET "status" = 'REVOKED', "updatedAt" = NOW()
FROM ranked
WHERE invite."id" = ranked."id" AND ranked.position > 1;

UPDATE "Invite" AS invite
SET "contaId" = usuario."contaId", "updatedAt" = NOW()
FROM "Usuario" AS usuario
WHERE invite."contaId" IS NULL AND invite."invitedById" = usuario."id";
