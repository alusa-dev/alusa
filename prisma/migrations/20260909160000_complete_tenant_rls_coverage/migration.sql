-- Completa a proteção RLS das tabelas tenant-scoped adicionadas depois dos
-- baselines iniciais. A aplicação usa DATABASE_RLS_URL com um papel que não é
-- proprietário das tabelas em produção; o contexto é definido por
-- runWithTenant/app.current_conta_id.
--
-- Tabelas com contaId nullable também recebem a policy. Linhas globais com
-- contaId NULL não devem ser acessíveis através do cliente tenant-scoped;
-- rotinas de plataforma devem usar a conexão administrativa apropriada.

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
    'AsaasCustomerSnapshot',
    'AsaasNotificationPreferenceOutbox',
    'AsaasNotificationSyncOutbox',
    'ContaFiscalSettings',
    'ContractEvidence',
    'ContractSignatureOtp',
    'ContractWhatsAppNotification',
    'Contrato',
    'ContratoConsentimentoTemplate',
    'ContratoDocumento',
    'ContratoModeloCampo',
    'ContratoModeloConsentimento',
    'EventBillingGroup',
    'EventFinancialPayment',
    'EventTicketSaleSeat',
    'EventoContrato',
    'EventoContratoDocumento',
    'EventoContratoEvidence',
    'FinanceDailyAggregate',
    'FinanceInstallmentPlanReadModel',
    'FinanceMonthlyAggregate',
    'FinancePaymentStateTransition',
    'FinanceReconciliationRun',
    'FinanceSubscriptionReadModel',
    'FinancialOperationalAlert',
    'FinancialTransactionSnapshot',
    'FinancialTransactionSyncWindow',
    'FiscalService',
    'InvoiceAuditEvent',
    'MatriculaBillingOutbox',
    'NotificationDigestEvent',
    'PlatformBillingIssue',
    'PlatformBillingPlanChange',
    'PlatformBillingWebhookEvent',
    'ReceivableAnticipationSnapshot',
    'RematriculaProcessoRevisao',
    'WhatsAppConnection',
    'WhatsAppMessage',
    'WhatsAppOutboundJob',
    'WhatsAppWebhookEvent'
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
