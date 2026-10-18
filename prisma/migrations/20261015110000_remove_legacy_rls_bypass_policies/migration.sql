-- Remove permissive legacy tenant policies that honored the caller-controlled
-- app.bypass_rls setting. Keep the canonical tenant_isolation policy intact.
DO $$
DECLARE
  legacy_policy record;
  affected_tables text[] := ARRAY[]::text[];
BEGIN
  FOR legacy_policy IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname <> 'tenant_isolation'
      AND (
        coalesce(qual, '') ILIKE '%app.bypass_rls%'
        OR coalesce(with_check, '') ILIKE '%app.bypass_rls%'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      legacy_policy.policyname,
      legacy_policy.schemaname,
      legacy_policy.tablename
    );
    affected_tables := array_append(affected_tables, legacy_policy.tablename);
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        coalesce(qual, '') ILIKE '%app.bypass_rls%'
        OR coalesce(with_check, '') ILIKE '%app.bypass_rls%'
      )
  ) THEN
    RAISE EXCEPTION 'Legacy app.bypass_rls RLS policies remain in public schema';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(affected_tables) AS affected(tablename)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_policies canonical
      JOIN pg_class relation ON relation.relname = canonical.tablename
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE canonical.schemaname = 'public'
        AND canonical.tablename = affected.tablename
        AND canonical.policyname = 'tenant_isolation'
        AND namespace.nspname = 'public'
        AND relation.relrowsecurity
        AND canonical.qual = '("contaId" = app_security.current_conta_id())'
        AND canonical.with_check = '("contaId" = app_security.current_conta_id())'
    )
  ) THEN
    RAISE EXCEPTION 'A table with a removed legacy bypass policy lacks enabled RLS and exact tenant_isolation USING/WITH CHECK predicates';
  END IF;
END $$;
