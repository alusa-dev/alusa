-- Signed PDF bytes move to private object storage. Keep arquivoUrl as a
-- backwards-compatible reference for existing document consumers; legacy rows
-- continue to use it for their base64 data URL until an optional backfill.
ALTER TABLE "ContratoDocumento"
ADD COLUMN "storageKey" TEXT;

ALTER TABLE "EventoContratoDocumento"
ADD COLUMN "storageKey" TEXT;
