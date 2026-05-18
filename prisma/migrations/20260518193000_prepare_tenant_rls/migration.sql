-- Tenant RLS baseline.
-- This enables row-level security policies for tenant-scoped tables without FORCE RLS.
-- The current owner role used by Prisma can continue operating during rollout; enforcement
-- becomes effective for a non-owner application role after setting app.current_conta_id.

CREATE SCHEMA IF NOT EXISTS app_security;

CREATE OR REPLACE FUNCTION app_security.current_conta_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_conta_id', true), '')
$$;

DO $$
DECLARE
  rel_name text;
  tenant_tables text[] := ARRAY[
    'Colaborador',
    'ContaFinancialPolicy',
    'AsaasNotificationPreference',
    'Professor',
    'Usuario',
    'UsuarioConta',
    'Aluno',
    'Responsavel',
    'AlunoResponsavel',
    'Turma',
    'Modalidade',
    'Sala',
    'TurmaProfessor',
    'CalendarEvent',
    'CalendarEventProfessor',
    'AttendanceRecord',
    'MakeupClass',
    'AulaExperimental',
    'AulasOperationLog',
    'Plano',
    'Matricula',
    'MatriculaFamiliar',
    'RematriculaFamiliar',
    'FamilyBillingOutbox',
    'MatriculaTurma',
    'Desconto',
    'Combo',
    'ComboTurma',
    'Cobranca',
    'MatriculaOperacao',
    'Pagamento',
    'WebhookAsaas',
    'WebhookAsaasArchive',
    'WebhookAsaasRejection',
    'LogFinanceiro',
    'LogIntegracao',
    'AsaasIntegrationJob',
    'Lancamento',
    'CentroCusto',
    'CategoriaLancamento',
    'Invite',
    'PortalEvento',
    'PortalEventoInscricao',
    'ContratoModelo',
    'ContratoTemplate',
    'FinanceProfile',
    'Customer',
    'Charge',
    'ChargeReadModel',
    'FinanceSummaryReadModel',
    'StandaloneInstallmentPlan',
    'StandaloneSubscription',
    'Invoice',
    'Subscription',
    'InstallmentPlan',
    'TransferRequest',
    'PixTransferSession',
    'TenantFeatureFlags',
    'AuditLog',
    'SupportCase',
    'SupportNote',
    'SupportAuditLog',
    'Notification',
    'NotificationRecipient',
    'PendingInboxNotification',
    'RematriculaOperacao',
    'PayerChangeOperacao',
    'ProductCategory',
    'Product',
    'Sale',
    'InventoryBalance',
    'InventoryMovement',
    'RestockOrder'
  ];
BEGIN
  FOREACH rel_name IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = rel_name
        AND column_name = 'contaId'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rel_name);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', rel_name);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON public.%I USING (%I = app_security.current_conta_id()) WITH CHECK (%I = app_security.current_conta_id())',
        rel_name,
        'contaId',
        'contaId'
      );
    END IF;
  END LOOP;
END $$;
