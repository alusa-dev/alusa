-- Seed the tenant-membership source of truth from the legacy default account
-- only when no explicit membership or access-removal audit exists.
-- This cutover requires an application version that authorizes from UsuarioConta.
-- Rolling back to a pre-membership binary is unsupported: that version can
-- authorize from Usuario.contaId even when this backfill intentionally skips a pair.
INSERT INTO "UsuarioConta" (
  "id",
  "usuarioId",
  "contaId",
  "role",
  "status",
  "createdAt",
  "updatedAt"
)
SELECT
  'legacy-membership-' || md5(u."id" || ':' || u."contaId"),
  u."id",
  u."contaId",
  u."role",
  u."status",
  u."createdAt",
  CURRENT_TIMESTAMP
FROM "Usuario" AS u
WHERE NOT EXISTS (
  SELECT 1
  FROM "UsuarioConta" AS uc
  WHERE uc."usuarioId" = u."id"
    AND uc."contaId" = u."contaId"
)
AND NOT EXISTS (
  SELECT 1
  FROM "AuditLog" AS audit
  WHERE audit."contaId" = u."contaId"
    AND audit."entityType" = 'UsuarioConta'
    AND (
      (
        audit.action = 'USER_TENANT_ACCESS_SUSPENDED'
        AND audit."entityId" = u."id" || ':' || u."contaId"
      )
      OR (
        audit.action = 'USER_TENANT_ACCESS_REMOVED'
        AND audit."entityId" = u."id"
      )
    )
)
ON CONFLICT ("usuarioId", "contaId") DO NOTHING;
