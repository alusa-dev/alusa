-- Additive and nullable so existing signed contracts remain valid.
ALTER TABLE "Contrato" ADD COLUMN "assinadoDataNascimento" TIMESTAMP(3);

ALTER TABLE "EventoContrato" ADD COLUMN "assinadoDataNascimento" TIMESTAMP(3);
