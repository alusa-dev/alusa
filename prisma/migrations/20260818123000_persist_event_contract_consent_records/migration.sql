-- Mantém uma projeção auditável e consultável das decisões que já compõem o
-- documento assinado. A origem é única por contrato e termo para que retries
-- da assinatura não criem registros duplicados.
ALTER TABLE "ConsentRecord"
ADD CONSTRAINT "uq_consent_record_conta_source" UNIQUE ("contaId", "source");

-- Retropreenche os contratos de evento já assinados. O JSON do contrato é o
-- snapshot jurídico canônico; ConsentRecord é somente o índice de consulta.
INSERT INTO "ConsentRecord" (
  "id", "contaId", "subjectType", "subjectId", "consentType", "legalBasis",
  "status", "grantedAt", "source", "metadata", "createdAt", "updatedAt"
)
SELECT
  'event-consent-' || md5(ec."id" || ':' || (decision.value ->> 'id')),
  ec."contaId",
  'ALUNO',
  ec."alunoId",
  COALESCE(decision.value ->> 'finalidade', 'CONTRACT_CONSENT'),
  'CONSENTIMENTO',
  CASE WHEN decision.value ->> 'decision' = 'AUTORIZADO' THEN 'GRANTED' ELSE 'DENIED' END,
  COALESCE(ec."assinadoEm", ec."updatedAt"),
  'EVENT_CONTRACT:' || ec."id" || ':' || (decision.value ->> 'id'),
  jsonb_build_object(
    'eventoContratoId', ec."id",
    'termoId', decision.value ->> 'id',
    'codigo', decision.value ->> 'codigo',
    'titulo', decision.value ->> 'titulo',
    'finalidade', decision.value ->> 'finalidade',
    'decision', decision.value ->> 'decision'
  ),
  COALESCE(ec."assinadoEm", ec."createdAt"),
  ec."updatedAt"
FROM "EventoContrato" ec
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ec."decisoesConsentimento", '[]'::jsonb)) AS decision(value)
WHERE ec."status" = 'ASSINADO'
  AND decision.value ? 'id'
ON CONFLICT ("contaId", "source") DO NOTHING;
