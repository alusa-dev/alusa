-- Multi-tenant access memberships.
-- Usuario remains the global login identity; UsuarioConta represents access to a school.

CREATE TABLE "UsuarioConta" (
  "id" TEXT NOT NULL,
  "usuarioId" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "role" "Role" NOT NULL,
  "status" "Status" NOT NULL DEFAULT 'ATIVO',
  "invitedById" TEXT,
  "inviteId" TEXT,
  "lastAccessedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UsuarioConta_pkey" PRIMARY KEY ("id")
);

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
  'uc_' || md5(u."id" || ':' || u."contaId"),
  u."id",
  u."contaId",
  u."role",
  u."status",
  u."createdAt",
  u."updatedAt"
FROM "Usuario" u
WHERE u."contaId" IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE UNIQUE INDEX "UsuarioConta_usuarioId_contaId_key"
  ON "UsuarioConta"("usuarioId", "contaId");

CREATE UNIQUE INDEX "UsuarioConta_inviteId_key"
  ON "UsuarioConta"("inviteId");

CREATE INDEX "idx_usuario_conta_conta_role_status"
  ON "UsuarioConta"("contaId", "role", "status");

CREATE INDEX "idx_usuario_conta_usuario_status"
  ON "UsuarioConta"("usuarioId", "status");

ALTER TABLE "UsuarioConta"
  ADD CONSTRAINT "UsuarioConta_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UsuarioConta"
  ADD CONSTRAINT "UsuarioConta_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UsuarioConta"
  ADD CONSTRAINT "UsuarioConta_invitedById_fkey"
  FOREIGN KEY ("invitedById") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UsuarioConta"
  ADD CONSTRAINT "UsuarioConta_inviteId_fkey"
  FOREIGN KEY ("inviteId") REFERENCES "Invite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
