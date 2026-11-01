-- Temporal source projection for platform billing eligibility. Hold source writes
-- while the truthful baseline and coverage boundary are established.
BEGIN;
LOCK TABLE "Aluno", "Matricula", "Plano", "Combo", "DescontoMatricula", "Conta", "PlatformBillingMonthlySnapshot", "PlatformBillingAuditLog" IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE "PlatformBillingEligibilityHistory" (
  "id" BIGSERIAL PRIMARY KEY,
  "contaId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "recordedAt" TIMESTAMPTZ(6) NOT NULL,
  "transactionId" TEXT NOT NULL DEFAULT txid_current()::text,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  "payload" JSONB NOT NULL,
  CONSTRAINT "PlatformBillingEligibilityHistory_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "idx_platform_billing_eligibility_history_lookup"
  ON "PlatformBillingEligibilityHistory" ("contaId", "entityType", "entityId", "recordedAt" DESC, "id" DESC);
CREATE INDEX "idx_platform_billing_eligibility_history_coverage"
  ON "PlatformBillingEligibilityHistory" ("contaId", "recordedAt");
CREATE INDEX "idx_platform_billing_eligibility_history_transaction"
  ON "PlatformBillingEligibilityHistory" ("contaId", "transactionId", "recordedAt");
ALTER TABLE "PlatformBillingEligibilityHistory" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PlatformBillingEligibilityHistory"
  USING ("contaId" = app_security.current_conta_id())
  WITH CHECK ("contaId" = app_security.current_conta_id());
REVOKE ALL PRIVILEGES ON TABLE "PlatformBillingEligibilityHistory" FROM PUBLIC;

CREATE TABLE "PlatformBillingEligibilityCoverage" (
  "contaId" TEXT PRIMARY KEY,
  "startedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "PlatformBillingEligibilityCoverage_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
ALTER TABLE "PlatformBillingMonthlySnapshot"
  ADD COLUMN "isRecovered" BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE "PlatformBillingMonthlySnapshot" s
SET "isRecovered" = TRUE
WHERE EXISTS (
  SELECT 1 FROM "PlatformBillingAuditLog" a
  WHERE a."contaId" = s."contaId"
    AND a.action = 'PLATFORM_BILLING_MONTHLY_SNAPSHOT_RECOVERED'
    AND a."entityType" = 'PlatformBillingMonthlySnapshot'
    AND a."entityId" = to_char(s."periodStart", 'YYYY-MM-DD')
    AND a.metadata->>'periodStart' = to_char(s."periodStart", 'YYYY-MM-DD')
    AND a.metadata->>'environment' = s.environment::text
);
ALTER TABLE "PlatformBillingEligibilityCoverage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PlatformBillingEligibilityCoverage"
  USING ("contaId" = app_security.current_conta_id())
  WITH CHECK ("contaId" = app_security.current_conta_id());
REVOKE ALL PRIVILEGES ON TABLE "PlatformBillingEligibilityCoverage" FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alusa_app') THEN
    REVOKE ALL PRIVILEGES ON TABLE "PlatformBillingEligibilityHistory", "PlatformBillingEligibilityCoverage" FROM alusa_app;
    GRANT SELECT ON TABLE "PlatformBillingEligibilityHistory", "PlatformBillingEligibilityCoverage" TO alusa_app;
    REVOKE ALL PRIVILEGES ON SEQUENCE "PlatformBillingEligibilityHistory_id_seq" FROM alusa_app;
  END IF;
END $$;
REVOKE ALL PRIVILEGES ON SEQUENCE "PlatformBillingEligibilityHistory_id_seq" FROM PUBLIC;

-- Capture only eligibility-relevant fields; no names, contact, financial IDs or
-- medical/student personal data are copied to this append-only projection.
CREATE FUNCTION "capture_platform_billing_eligibility_history"() RETURNS trigger AS $$
DECLARE
  source_row JSONB;
  tenant_id TEXT;
  source_id TEXT;
  kind TEXT := TG_ARGV[0];
  deleted BOOLEAN := TG_OP = 'DELETE';
  happened_at TIMESTAMPTZ(6);
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR NOT (
    (kind = 'STUDENT' AND TG_RELID = 'public."Aluno"'::regclass) OR
    (kind = 'ENROLLMENT' AND TG_RELID = 'public."Matricula"'::regclass) OR
    (kind = 'PLAN' AND TG_RELID = 'public."Plano"'::regclass) OR
    (kind = 'COMBO' AND TG_RELID = 'public."Combo"'::regclass) OR
    (kind = 'DISCOUNT' AND TG_RELID = 'public."DescontoMatricula"'::regclass)
  ) THEN
    RAISE EXCEPTION 'Unsupported source relation for platform billing eligibility history';
  END IF;
  source_row := CASE WHEN deleted THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  source_id := source_row->>'id';
  IF kind = 'DISCOUNT' THEN
    SELECT m."contaId" INTO tenant_id FROM "Matricula" m WHERE m.id = source_row->>'matriculaId';
    IF tenant_id IS NULL THEN
      SELECT h."contaId" INTO tenant_id FROM "PlatformBillingEligibilityHistory" h
        WHERE h."entityType" = 'DISCOUNT' AND h."entityId" = source_id
        ORDER BY h."recordedAt" DESC, h.id DESC LIMIT 1;
    END IF;
  ELSE
    tenant_id := source_row->>'contaId';
  END IF;
  IF tenant_id IS NULL THEN RAISE EXCEPTION 'Cannot determine tenant for platform billing eligibility history'; END IF;
  -- Shared effective-time ordering: the close takes the same transaction lock
  -- before reading; it therefore waits for mutations already in flight.
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('platform-billing-eligibility:' || tenant_id, 0));
  -- This is the per-row mutation effective time (after the source row lock),
  -- not transaction commit time. The shared tenant xact lock lets writers
  -- proceed concurrently while the close's exclusive lock drains them.
  happened_at := clock_timestamp();
  IF TG_OP = 'UPDATE' THEN
    IF kind = 'DISCOUNT' THEN
      IF OLD."matriculaId" IS DISTINCT FROM NEW."matriculaId" THEN
        RAISE EXCEPTION 'Platform billing eligibility history does not support discount enrollment reassignment';
      END IF;
      IF OLD."valorFinal" IS NOT DISTINCT FROM NEW."valorFinal" THEN RETURN NEW; END IF;
    ELSIF kind = 'STUDENT' THEN
      IF OLD."contaId" IS DISTINCT FROM NEW."contaId" THEN RAISE EXCEPTION 'Platform billing eligibility history does not support tenant reassignment'; END IF;
      IF (OLD.status, OLD."dataInativacao") IS NOT DISTINCT FROM (NEW.status, NEW."dataInativacao") THEN RETURN NEW; END IF;
    ELSIF kind = 'ENROLLMENT' THEN
      IF OLD."contaId" IS DISTINCT FROM NEW."contaId" THEN RAISE EXCEPTION 'Platform billing eligibility history does not support tenant reassignment'; END IF;
      IF (OLD."alunoId", OLD."comboId", OLD."planoId", OLD.status, OLD."dataInicio", OLD."dataFim", OLD."dataFimContrato", OLD."cancelledAt", OLD."dataInicioPausa", OLD."cobrarDurantePausa")
        IS NOT DISTINCT FROM (NEW."alunoId", NEW."comboId", NEW."planoId", NEW.status, NEW."dataInicio", NEW."dataFim", NEW."dataFimContrato", NEW."cancelledAt", NEW."dataInicioPausa", NEW."cobrarDurantePausa") THEN RETURN NEW; END IF;
    ELSIF kind = 'PLAN' THEN
      IF OLD."contaId" IS DISTINCT FROM NEW."contaId" THEN RAISE EXCEPTION 'Platform billing eligibility history does not support tenant reassignment'; END IF;
      IF (OLD.valor, OLD.status) IS NOT DISTINCT FROM (NEW.valor, NEW.status) THEN RETURN NEW; END IF;
    ELSIF kind = 'COMBO' THEN
      IF OLD."contaId" IS DISTINCT FROM NEW."contaId" THEN RAISE EXCEPTION 'Platform billing eligibility history does not support tenant reassignment'; END IF;
      IF (OLD.valor, OLD.status) IS NOT DISTINCT FROM (NEW.valor, NEW.status) THEN RETURN NEW; END IF;
    END IF;
  END IF;
  IF kind = 'DISCOUNT' THEN
    INSERT INTO "PlatformBillingEligibilityHistory" ("contaId", "entityType", "entityId", "recordedAt", "isDeleted", "payload")
    VALUES (tenant_id, 'DISCOUNT', source_id, happened_at, deleted,
      jsonb_build_object('matriculaId', source_row->>'matriculaId', 'valorFinal', source_row->>'valorFinal'));
  ELSE
    tenant_id := source_row->>'contaId';
    IF kind = 'STUDENT' THEN
    INSERT INTO "PlatformBillingEligibilityHistory" ("contaId", "entityType", "entityId", "recordedAt", "isDeleted", "payload") VALUES (tenant_id, kind, source_id, happened_at, deleted,
        jsonb_build_object('status', source_row->>'status', 'dataInativacao', source_row->>'dataInativacao'));
    ELSIF kind = 'ENROLLMENT' THEN
      INSERT INTO "PlatformBillingEligibilityHistory" ("contaId", "entityType", "entityId", "recordedAt", "isDeleted", "payload") VALUES (tenant_id, kind, source_id, happened_at, deleted,
        jsonb_build_object('alunoId', source_row->>'alunoId', 'comboId', source_row->>'comboId', 'planoId', source_row->>'planoId',
          'status', source_row->>'status', 'dataInicio', source_row->>'dataInicio', 'dataFim', source_row->>'dataFim',
          'dataFimContrato', source_row->>'dataFimContrato', 'cancelledAt', source_row->>'cancelledAt',
          'dataInicioPausa', source_row->>'dataInicioPausa', 'cobrarDurantePausa', source_row->>'cobrarDurantePausa'));
    ELSIF kind = 'PLAN' THEN
      INSERT INTO "PlatformBillingEligibilityHistory" ("contaId", "entityType", "entityId", "recordedAt", "isDeleted", "payload") VALUES (tenant_id, kind, source_id, happened_at, deleted,
        jsonb_build_object('valor', source_row->>'valor', 'status', source_row->>'status'));
    ELSIF kind = 'COMBO' THEN
      INSERT INTO "PlatformBillingEligibilityHistory" ("contaId", "entityType", "entityId", "recordedAt", "isDeleted", "payload") VALUES (tenant_id, kind, source_id, happened_at, deleted,
        jsonb_build_object('valor', source_row->>'valor', 'status', source_row->>'status'));
    END IF;
  END IF;
  IF deleted THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE FUNCTION "mark_platform_billing_eligibility_coverage"() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_RELID <> 'public."Conta"'::regclass THEN
    RAISE EXCEPTION 'Unsupported source relation for platform billing eligibility coverage';
  END IF;
  INSERT INTO "PlatformBillingEligibilityCoverage" ("contaId", "startedAt") VALUES (NEW.id, clock_timestamp())
    ON CONFLICT ("contaId") DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE FUNCTION "mark_recovered_platform_billing_snapshot"() RETURNS trigger AS $$
DECLARE
  period_text TEXT;
  billing_environment TEXT;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_RELID <> 'public."PlatformBillingAuditLog"'::regclass THEN
    RAISE EXCEPTION 'Unsupported source relation for recovered platform billing snapshot';
  END IF;
  IF NEW.action <> 'PLATFORM_BILLING_MONTHLY_SNAPSHOT_RECOVERED'
    OR NEW."entityType" IS DISTINCT FROM 'PlatformBillingMonthlySnapshot'
    OR NEW."entityId" IS NULL OR NEW.metadata IS NULL THEN RETURN NEW; END IF;
  billing_environment := NEW.metadata->>'environment';
  IF billing_environment IS NULL OR billing_environment NOT IN ('TEST', 'LIVE') THEN RETURN NEW; END IF;
  period_text := NEW.metadata->>'periodStart';
  IF period_text IS NULL OR period_text <> NEW."entityId" THEN RETURN NEW; END IF;
  UPDATE "PlatformBillingMonthlySnapshot"
  SET "isRecovered" = TRUE
  WHERE "contaId" = NEW."contaId"
    AND environment::text = billing_environment
    AND to_char("periodStart", 'YYYY-MM-DD') = period_text;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Baseline at a truthful timestamp; close-period queries use this projection
-- only when coverage began no later than the competence end.
INSERT INTO "PlatformBillingEligibilityHistory" ("contaId", "entityType", "entityId", "recordedAt", "isDeleted", "payload")
SELECT "contaId", 'STUDENT', id, clock_timestamp(), FALSE,
  jsonb_build_object('status', status, 'dataInativacao', "dataInativacao") FROM "Aluno";
INSERT INTO "PlatformBillingEligibilityHistory" ("contaId", "entityType", "entityId", "recordedAt", "isDeleted", "payload")
SELECT "contaId", 'ENROLLMENT', id, clock_timestamp(), FALSE,
  jsonb_build_object('alunoId', "alunoId", 'comboId', "comboId", 'planoId', "planoId", 'status', status,
    'dataInicio', "dataInicio", 'dataFim', "dataFim", 'dataFimContrato', "dataFimContrato", 'cancelledAt', "cancelledAt",
    'dataInicioPausa', "dataInicioPausa", 'cobrarDurantePausa', "cobrarDurantePausa") FROM "Matricula";
INSERT INTO "PlatformBillingEligibilityHistory" ("contaId", "entityType", "entityId", "recordedAt", "isDeleted", "payload")
SELECT "contaId", 'PLAN', id, clock_timestamp(), FALSE, jsonb_build_object('valor', valor, 'status', status) FROM "Plano";
INSERT INTO "PlatformBillingEligibilityHistory" ("contaId", "entityType", "entityId", "recordedAt", "isDeleted", "payload")
SELECT "contaId", 'COMBO', id, clock_timestamp(), FALSE, jsonb_build_object('valor', valor, 'status', status) FROM "Combo";
INSERT INTO "PlatformBillingEligibilityHistory" ("contaId", "entityType", "entityId", "recordedAt", "isDeleted", "payload")
SELECT m."contaId", 'DISCOUNT', d.id, clock_timestamp(), FALSE,
  jsonb_build_object('matriculaId', d."matriculaId", 'valorFinal', d."valorFinal")
FROM "DescontoMatricula" d JOIN "Matricula" m ON m.id = d."matriculaId";
INSERT INTO "PlatformBillingEligibilityCoverage" ("contaId", "startedAt") SELECT id, clock_timestamp() FROM "Conta";

CREATE TRIGGER "Aluno_platform_billing_eligibility_history"
  BEFORE INSERT OR UPDATE OR DELETE ON "Aluno" FOR EACH ROW EXECUTE FUNCTION "capture_platform_billing_eligibility_history"('STUDENT');
CREATE TRIGGER "Matricula_platform_billing_eligibility_history"
  BEFORE INSERT OR UPDATE OR DELETE ON "Matricula" FOR EACH ROW EXECUTE FUNCTION "capture_platform_billing_eligibility_history"('ENROLLMENT');
CREATE TRIGGER "Plano_platform_billing_eligibility_history"
  BEFORE INSERT OR UPDATE OR DELETE ON "Plano" FOR EACH ROW EXECUTE FUNCTION "capture_platform_billing_eligibility_history"('PLAN');
CREATE TRIGGER "Combo_platform_billing_eligibility_history"
  BEFORE INSERT OR UPDATE OR DELETE ON "Combo" FOR EACH ROW EXECUTE FUNCTION "capture_platform_billing_eligibility_history"('COMBO');
CREATE TRIGGER "DescontoMatricula_platform_billing_eligibility_history"
  BEFORE INSERT OR UPDATE OR DELETE ON "DescontoMatricula" FOR EACH ROW EXECUTE FUNCTION "capture_platform_billing_eligibility_history"('DISCOUNT');
CREATE TRIGGER "Conta_platform_billing_eligibility_coverage"
  AFTER INSERT ON "Conta" FOR EACH ROW EXECUTE FUNCTION "mark_platform_billing_eligibility_coverage"();
CREATE TRIGGER "PlatformBillingAuditLog_mark_recovered_snapshot"
  AFTER INSERT ON "PlatformBillingAuditLog" FOR EACH ROW EXECUTE FUNCTION "mark_recovered_platform_billing_snapshot"();

CREATE FUNCTION "reject_platform_billing_eligibility_history_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Platform billing eligibility history is append-only';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
CREATE TRIGGER "PlatformBillingEligibilityHistory_immutable"
  BEFORE UPDATE OR DELETE ON "PlatformBillingEligibilityHistory" FOR EACH ROW EXECUTE FUNCTION "reject_platform_billing_eligibility_history_mutation"();
CREATE TRIGGER "PlatformBillingEligibilityCoverage_immutable"
  BEFORE UPDATE OR DELETE ON "PlatformBillingEligibilityCoverage" FOR EACH ROW EXECUTE FUNCTION "reject_platform_billing_eligibility_history_mutation"();
REVOKE EXECUTE ON FUNCTION "capture_platform_billing_eligibility_history"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "mark_platform_billing_eligibility_coverage"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "mark_recovered_platform_billing_snapshot"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "reject_platform_billing_eligibility_history_mutation"() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alusa_app') THEN
    REVOKE EXECUTE ON FUNCTION "capture_platform_billing_eligibility_history"() FROM alusa_app;
    REVOKE EXECUTE ON FUNCTION "mark_platform_billing_eligibility_coverage"() FROM alusa_app;
    REVOKE EXECUTE ON FUNCTION "mark_recovered_platform_billing_snapshot"() FROM alusa_app;
    REVOKE EXECUTE ON FUNCTION "reject_platform_billing_eligibility_history_mutation"() FROM alusa_app;
  END IF;
END $$;
COMMIT;
