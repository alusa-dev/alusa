-- Grants for the least-privilege runtime role used by the RLS rollout.
-- Role creation/password rotation is intentionally handled outside Prisma migrations.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alusa_app') THEN
    EXECUTE 'GRANT CONNECT ON DATABASE neondb TO alusa_app';
    EXECUTE 'GRANT USAGE ON SCHEMA public TO alusa_app';
    EXECUTE 'GRANT USAGE ON SCHEMA app_security TO alusa_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO alusa_app';
    EXECUTE 'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO alusa_app';
    EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO alusa_app';
    EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_security TO alusa_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO alusa_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO alusa_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO alusa_app';
  END IF;
END $$;

