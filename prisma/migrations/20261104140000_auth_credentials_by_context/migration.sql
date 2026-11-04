-- Fail before changing schema if legacy identities cannot be mapped
-- unambiguously to the realm email key. Resolve the conflicting Usuario
-- records and rerun the migration; never strand them without credentials.
DO $$
DECLARE
  collision_groups BIGINT;
BEGIN
  WITH occupied AS (
    SELECT c."ownerUserId" AS "userId", 'OWNER'::TEXT AS context
    FROM "Conta" c JOIN "Usuario" u ON u.id = c."ownerUserId"
    WHERE c."ownerUserId" IS NOT NULL AND btrim(u.email) <> ''
    UNION
    SELECT uc."usuarioId", 'COLLABORATOR'::TEXT
    FROM "UsuarioConta" uc JOIN "Usuario" u ON u.id = uc."usuarioId"
    WHERE uc.status = 'ATIVO' AND uc.role <> 'RESPONSAVEL' AND btrim(u.email) <> ''
      AND EXISTS (SELECT 1 FROM "Conta" c WHERE c.id = uc."contaId" AND c.status = 'ATIVO' AND c."deletedAt" IS NULL AND c."ownerUserId" IS DISTINCT FROM uc."usuarioId")
    UNION
    SELECT u.id, 'PORTAL'::TEXT
    FROM "Usuario" u
    WHERE btrim(u.email) <> '' AND (
      EXISTS (SELECT 1 FROM "Aluno" a JOIN "Conta" c ON c.id = a."contaId" WHERE a."usuarioId" = u.id AND c.status = 'ATIVO' AND c."deletedAt" IS NULL)
      OR EXISTS (SELECT 1 FROM "Responsavel" r JOIN "Conta" c ON c.id = r."contaId" WHERE r."usuarioId" = u.id AND c.status = 'ATIVO' AND c."deletedAt" IS NULL)
    )
  ), candidates AS (
    SELECT DISTINCT o.context, u.id AS "userId", lower(btrim(u.email)) AS "normalizedEmail"
    FROM occupied o JOIN "Usuario" u ON u.id = o."userId"
  )
  SELECT count(*) INTO collision_groups
  FROM (
    SELECT context, "normalizedEmail"
    FROM candidates
    GROUP BY context, "normalizedEmail"
    HAVING count(DISTINCT "userId") > 1
  ) collisions;

  IF collision_groups > 0 THEN
    RAISE EXCEPTION 'Auth credential migration stopped: % normalized-email collision group(s) exist within an occupied auth context. Resolve the conflicting Usuario emails and rerun the migration.', collision_groups;
  END IF;
END $$;

CREATE TYPE "AuthContext" AS ENUM ('OWNER', 'COLLABORATOR', 'PORTAL');

CREATE TABLE "AuthCredential" (
  "id" TEXT NOT NULL,
  "context" "AuthContext" NOT NULL,
  "normalizedEmail" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "emailVerifiedAt" TIMESTAMP(3),
  "sessionVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthCredential_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AuthActionToken" ADD COLUMN "context" "AuthContext";

CREATE UNIQUE INDEX "uq_auth_credential_context_email" ON "AuthCredential"("context", "normalizedEmail");
CREATE UNIQUE INDEX "uq_auth_credential_context_user" ON "AuthCredential"("context", "userId");
CREATE INDEX "idx_auth_credential_user" ON "AuthCredential"("userId");
ALTER TABLE "AuthCredential" ADD CONSTRAINT "AuthCredential_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copy the legacy credential only into realms the actor already occupies.
-- Ambiguous normalized-email collisions are excluded rather than assigned arbitrarily.
WITH occupied AS (
  SELECT c."ownerUserId" AS "userId", 'OWNER'::"AuthContext" AS context
  FROM "Conta" c JOIN "Usuario" u ON u.id = c."ownerUserId"
  WHERE c."ownerUserId" IS NOT NULL AND btrim(u.email) <> ''
  UNION
  SELECT uc."usuarioId", 'COLLABORATOR'::"AuthContext"
  FROM "UsuarioConta" uc JOIN "Usuario" u ON u.id = uc."usuarioId"
  WHERE uc.status = 'ATIVO' AND uc.role <> 'RESPONSAVEL' AND btrim(u.email) <> ''
    AND EXISTS (SELECT 1 FROM "Conta" c WHERE c.id = uc."contaId" AND c.status = 'ATIVO' AND c."deletedAt" IS NULL AND c."ownerUserId" IS DISTINCT FROM uc."usuarioId")
  UNION
  SELECT u.id, 'PORTAL'::"AuthContext"
  FROM "Usuario" u
  WHERE btrim(u.email) <> '' AND (
    EXISTS (SELECT 1 FROM "Aluno" a JOIN "Conta" c ON c.id = a."contaId" WHERE a."usuarioId" = u.id AND c.status = 'ATIVO' AND c."deletedAt" IS NULL)
    OR EXISTS (SELECT 1 FROM "Responsavel" r JOIN "Conta" c ON c.id = r."contaId" WHERE r."usuarioId" = u.id AND c.status = 'ATIVO' AND c."deletedAt" IS NULL)
  )
), candidates AS (
  SELECT DISTINCT o.context, u.id AS "userId", lower(btrim(u.email)) AS "normalizedEmail", u."senhaHash" AS "passwordHash", u."emailVerifiedAt"
  FROM occupied o JOIN "Usuario" u ON u.id = o."userId"
), unambiguous AS (
  SELECT context, "userId", "normalizedEmail", "passwordHash", "emailVerifiedAt"
  FROM candidates c
  WHERE NOT EXISTS (
    SELECT 1 FROM candidates collision
    WHERE collision.context = c.context AND collision."normalizedEmail" = c."normalizedEmail"
      AND collision."userId" <> c."userId"
  )
)
INSERT INTO "AuthCredential" ("id", "context", "normalizedEmail", "userId", "passwordHash", "emailVerifiedAt", "sessionVersion", "createdAt", "updatedAt")
SELECT 'ac_' || md5(context::text || ':' || "userId"), context, "normalizedEmail", "userId", "passwordHash", "emailVerifiedAt", 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM unambiguous
ON CONFLICT ("context", "userId") DO NOTHING;

-- Keep legacy verification/reset links only when the user has exactly one
-- credential realm; otherwise the old token has no safe realm target.
WITH single_context AS (
  SELECT "userId", (array_agg("context"))[1] AS context
  FROM "AuthCredential"
  GROUP BY "userId"
  HAVING count(*) = 1
)
UPDATE "AuthActionToken" token SET "context" = single_context.context
FROM single_context
WHERE token."userId" = single_context."userId"
  AND token."context" IS NULL
  AND token."type" IN ('VERIFY_EMAIL', 'RESET_PASSWORD');

UPDATE "AuthActionToken" SET "invalidatedAt" = CURRENT_TIMESTAMP
WHERE "context" IS NULL
  AND "type" IN ('VERIFY_EMAIL', 'RESET_PASSWORD')
  AND "usedAt" IS NULL AND "invalidatedAt" IS NULL;

ALTER TABLE "MobileAuthSession"
  ADD COLUMN "authContext" "AuthContext" NOT NULL DEFAULT 'COLLABORATOR';
ALTER TABLE "MobileAuthSession" ADD COLUMN "activeContaId" TEXT;
ALTER TABLE "PasswordChangeOtp"
  ADD COLUMN "authContext" "AuthContext" NOT NULL DEFAULT 'COLLABORATOR';

-- Legacy sessions and password-change challenges did not carry a realm or a
-- selected account. Require users to sign in again to establish both safely.
UPDATE "MobileAuthSession"
SET "revokedAt" = CURRENT_TIMESTAMP
WHERE "revokedAt" IS NULL;

UPDATE "PasswordChangeOtp"
SET "invalidatedAt" = CURRENT_TIMESTAMP
WHERE "usedAt" IS NULL AND "invalidatedAt" IS NULL;
