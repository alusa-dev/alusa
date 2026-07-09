CREATE TABLE IF NOT EXISTS "RematriculaProcessoRevisao" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "processoId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "actorId" TEXT,
  "beforeState" JSONB NOT NULL,
  "afterState" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RematriculaProcessoRevisao_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_rematricula_processo_revisao_version"
  ON "RematriculaProcessoRevisao"("contaId", "processoId", "version");

CREATE INDEX IF NOT EXISTS "idx_rematricula_processo_revisao_created"
  ON "RematriculaProcessoRevisao"("contaId", "processoId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RematriculaProcessoRevisao_contaId_fkey'
  ) THEN
    ALTER TABLE "RematriculaProcessoRevisao"
      ADD CONSTRAINT "RematriculaProcessoRevisao_contaId_fkey"
      FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RematriculaProcessoRevisao_processoId_fkey'
  ) THEN
    ALTER TABLE "RematriculaProcessoRevisao"
      ADD CONSTRAINT "RematriculaProcessoRevisao_processoId_fkey"
      FOREIGN KEY ("processoId") REFERENCES "RematriculaProcesso"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
