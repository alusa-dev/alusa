-- Completa a cobertura RLS para tabelas tenant-scoped adicionadas após o baseline.
-- A policy usa o contexto definido por runWithTenant/app.current_conta_id.

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
    'FinanceReconciliationIssue',
    'FinanceWebhookSideEffectOutbox',
    'SchoolEvent',
    'EventTicketLot',
    'EventMap',
    'EventMapVersion',
    'EventMapLevel',
    'EventSeatGroup',
    'EventMapObject',
    'EventMapSection',
    'EventSeat',
    'EventMapPublicSeat',
    'EventMapReservation',
    'EventMapReservationSeat',
    'EventMapOrder',
    'EventMapOrderItem',
    'EventTicket',
    'EventTicketSale',
    'EventCostume',
    'EventCostumeAssignment',
    'EventFinancialEntry',
    'EventParticipant',
    'EventReport',
    'EventAudit'
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
