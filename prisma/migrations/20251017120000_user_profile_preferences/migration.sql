-- Add profile preference fields to Usuario
ALTER TABLE "Usuario"
  ADD COLUMN "bio" TEXT,
  ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'pt-BR',
  ADD COLUMN "theme" TEXT NOT NULL DEFAULT 'system';
