-- Ensure the RLS runtime role can connect to the database where this migration runs.

DO $$
DECLARE
  database_name text := current_database();
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alusa_app') THEN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO alusa_app', database_name);
  END IF;
END $$;

