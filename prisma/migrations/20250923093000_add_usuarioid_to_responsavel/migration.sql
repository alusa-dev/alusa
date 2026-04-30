-- Add usuarioId to Responsavel and backrelation FK to Usuario
ALTER TABLE "Responsavel" ADD COLUMN "usuarioId" TEXT;

-- Unique constraint for 1-1 link between Responsavel and Usuario (nullable allows many NULLs)
CREATE UNIQUE INDEX "Responsavel_usuarioId_key" ON "Responsavel"("usuarioId");

-- Foreign key with ON DELETE SET NULL to match onDelete: SetNull in Prisma
ALTER TABLE "Responsavel" ADD CONSTRAINT "Responsavel_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;