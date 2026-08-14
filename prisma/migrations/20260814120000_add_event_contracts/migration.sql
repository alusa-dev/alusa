-- Contratos de eventos são deliberadamente separados de contratos acadêmicos.
CREATE TYPE "ContratoDocumentoTipo_new" AS ENUM ('MODELO_ORIGINAL', 'GERADO_MATRICULA', 'GERADO_EVENTO', 'ASSINADO', 'CERTIFICADO_EVIDENCIAS');

ALTER TABLE "ContratoDocumento" ALTER COLUMN "tipo" TYPE "ContratoDocumentoTipo_new" USING ("tipo"::text::"ContratoDocumentoTipo_new");
DROP TYPE "ContratoDocumentoTipo";
ALTER TYPE "ContratoDocumentoTipo_new" RENAME TO "ContratoDocumentoTipo";

ALTER TABLE "SchoolEvent" ADD COLUMN "contratoModeloId" TEXT;
CREATE INDEX "idx_school_event_conta_contrato_modelo" ON "SchoolEvent"("contaId", "contratoModeloId");
ALTER TABLE "SchoolEvent" ADD CONSTRAINT "SchoolEvent_contratoModeloId_fkey" FOREIGN KEY ("contratoModeloId") REFERENCES "ContratoModelo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "EventoContrato" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "alunoId" TEXT NOT NULL,
    "responsavelId" TEXT,
    "modeloId" TEXT NOT NULL,
    "arquivoPdfUrl" TEXT NOT NULL,
    "hashPdf" TEXT NOT NULL,
    "arquivoPdfAssinadoUrl" TEXT,
    "hashPdfAssinado" TEXT,
    "camposAssinaturaSnapshot" JSONB,
    "status" "StatusAssinatura" NOT NULL DEFAULT 'PENDENTE',
    "assinadoPor" TEXT,
    "assinadoEmail" TEXT,
    "assinadoCpf" TEXT,
    "assinadoIp" TEXT,
    "assinadoEm" TIMESTAMP(3),
    "assinadoUserAgent" TEXT,
    "hashAssinatura" TEXT,
    "tokenPublico" TEXT NOT NULL,
    "tokenPublicoHash" TEXT,
    "tokenExpiraEm" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventoContrato_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventoContratoDocumento" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "eventoContratoId" TEXT NOT NULL,
    "tipo" "ContratoDocumentoTipo" NOT NULL,
    "arquivoUrl" TEXT NOT NULL,
    "hashSha256" TEXT NOT NULL,
    "tamanhoBytes" INTEGER,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoContratoDocumento_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventoContratoEvidence" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "eventoContratoId" TEXT NOT NULL,
    "type" "ContractEvidenceType" NOT NULL,
    "actorType" TEXT,
    "actorId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoContratoEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventoContrato_tokenPublico_key" ON "EventoContrato"("tokenPublico");
CREATE UNIQUE INDEX "uq_evento_contrato_conta_evento_aluno" ON "EventoContrato"("contaId", "eventId", "alunoId");
CREATE UNIQUE INDEX "uq_evento_contrato_conta_participante" ON "EventoContrato"("contaId", "participantId");
CREATE INDEX "idx_evento_contrato_conta_aluno_status" ON "EventoContrato"("contaId", "alunoId", "status");
CREATE INDEX "idx_evento_contrato_conta_evento_status" ON "EventoContrato"("contaId", "eventId", "status");
CREATE INDEX "idx_evento_contrato_conta_token_hash" ON "EventoContrato"("contaId", "tokenPublicoHash");
CREATE INDEX "idx_evento_contrato_conta_created" ON "EventoContrato"("contaId", "createdAt");
CREATE INDEX "idx_evento_contrato_documento_conta_contrato" ON "EventoContratoDocumento"("contaId", "eventoContratoId");
CREATE INDEX "idx_evento_contrato_documento_conta_tipo" ON "EventoContratoDocumento"("contaId", "tipo");
CREATE INDEX "idx_evento_contrato_evidence_conta_contract_created" ON "EventoContratoEvidence"("contaId", "eventoContratoId", "createdAt");
CREATE INDEX "idx_evento_contrato_evidence_conta_type_created" ON "EventoContratoEvidence"("contaId", "type", "createdAt");

ALTER TABLE "EventoContrato" ADD CONSTRAINT "EventoContrato_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventoContrato" ADD CONSTRAINT "EventoContrato_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SchoolEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventoContrato" ADD CONSTRAINT "EventoContrato_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "EventParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventoContrato" ADD CONSTRAINT "EventoContrato_alunoId_fkey" FOREIGN KEY ("alunoId") REFERENCES "Aluno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventoContrato" ADD CONSTRAINT "EventoContrato_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Responsavel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventoContrato" ADD CONSTRAINT "EventoContrato_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "ContratoModelo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventoContrato" ADD CONSTRAINT "EventoContrato_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EventoContratoDocumento" ADD CONSTRAINT "EventoContratoDocumento_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventoContratoDocumento" ADD CONSTRAINT "EventoContratoDocumento_eventoContratoId_fkey" FOREIGN KEY ("eventoContratoId") REFERENCES "EventoContrato"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventoContratoEvidence" ADD CONSTRAINT "EventoContratoEvidence_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventoContratoEvidence" ADD CONSTRAINT "EventoContratoEvidence_eventoContratoId_fkey" FOREIGN KEY ("eventoContratoId") REFERENCES "EventoContrato"("id") ON DELETE CASCADE ON UPDATE CASCADE;
