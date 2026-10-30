-- Tenant defense in depth for the customer agreement acceptance record.
-- The commercial invitation itself remains platform-level; acceptance is scoped
-- to its Conta and must follow the existing current_conta_id policy contract.
CREATE SCHEMA IF NOT EXISTS app_security;

CREATE OR REPLACE FUNCTION app_security.current_conta_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_conta_id', true), '')
$$;

ALTER TABLE public."PlatformSchoolInvitationConditionAcceptance"
  ADD COLUMN "selectedStudentCount" INTEGER,
  ADD COLUMN "selectedPlanCode" "PlatformBillingPlanCode",
  ADD COLUMN "selectedMonthlyAmountCents" INTEGER;

-- Preserve existing acceptance evidence if this migration follows a deployment
-- that already recorded terms before count-specific acceptance was added.
UPDATE public."PlatformSchoolInvitationConditionAcceptance" AS acceptance
SET "selectedStudentCount" = invitation."studentCount",
    "selectedPlanCode" = CASE
      WHEN invitation."conditionType" = 'CUSTOM' THEN 'CUSTOM'::"PlatformBillingPlanCode"
      ELSE invitation."planCode"
    END,
    "selectedMonthlyAmountCents" = CASE
      WHEN invitation."conditionType" = 'CUSTOM' THEN invitation."monthlyAmountCents"
      ELSE CASE invitation."planCode"
        WHEN 'BAND_001_025' THEN 16900
        WHEN 'BAND_026_050' THEN 22900
        WHEN 'BAND_051_100' THEN 28900
        WHEN 'BAND_101_150' THEN 34900
        WHEN 'BAND_151_200' THEN 41900
        WHEN 'BAND_201_300' THEN 47900
        WHEN 'BAND_301_400' THEN 55900
        WHEN 'BAND_401_500' THEN 64900
        ELSE NULL
      END
    END
FROM public."PlatformSchoolInvitation" AS invitation
WHERE invitation."id" = acceptance."invitationId";

ALTER TABLE public."PlatformSchoolInvitationConditionAcceptance"
  ALTER COLUMN "selectedStudentCount" SET NOT NULL,
  ADD CONSTRAINT "PlatformSchoolInvitationConditionAcceptance_selectedStudentCount_check" CHECK ("selectedStudentCount" >= 1),
  ADD CONSTRAINT "PlatformSchoolInvitationConditionAcceptance_selectedMonthlyAmountCents_check" CHECK ("selectedMonthlyAmountCents" IS NULL OR "selectedMonthlyAmountCents" > 0);

DROP INDEX IF EXISTS public."PlatformSchoolInvitationConditionAcceptance_invitationId_version_contaId_key";
CREATE UNIQUE INDEX "PlatformSchoolInvitationConditionAcceptance_invitationId_version_contaId_selectedStudentCount_key"
  ON public."PlatformSchoolInvitationConditionAcceptance"("invitationId", "version", "contaId", "selectedStudentCount");
DROP INDEX IF EXISTS public."PlatformSchoolInvitationConditionAcceptance_contaId_invitationId_version_idx";
CREATE INDEX "PlatformSchoolInvitationConditionAcceptance_contaId_invitationId_version_selectedStudentCount_idx"
  ON public."PlatformSchoolInvitationConditionAcceptance"("contaId", "invitationId", "version", "selectedStudentCount");

ALTER TABLE public."PlatformSchoolInvitationConditionAcceptance" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."PlatformSchoolInvitationConditionAcceptance";
CREATE POLICY tenant_isolation ON public."PlatformSchoolInvitationConditionAcceptance"
  USING ("contaId" = app_security.current_conta_id())
  WITH CHECK ("contaId" = app_security.current_conta_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alusa_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE public."PlatformSchoolInvitationConditionAcceptance" TO alusa_app;
  END IF;
END $$;
