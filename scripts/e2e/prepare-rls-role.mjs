#!/usr/bin/env node

import process from 'node:process';
import { URL } from 'node:url';
import pg from 'pg';

const { Client } = pg;

function parseDatabaseUrl(rawValue) {
  const value = String(rawValue ?? '').trim();
  if (!value) throw new Error('DATABASE_URL é obrigatório para preparar o papel RLS de E2E.');

  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  const isTestDatabase = databaseName.toLowerCase().includes('test');

  if (!isTestDatabase) {
    throw new Error(`O papel RLS de E2E só pode ser preparado em banco *_test (atual: ${databaseName}).`);
  }

  if (!isLocal && process.env.E2E_ALLOW_REMOTE_DB !== 'true') {
    throw new Error(
      'O papel RLS de E2E exige PostgreSQL local. Use E2E_ALLOW_REMOTE_DB=true somente em um banco descartável autorizado.',
    );
  }

  parsed.search = '';
  return parsed.toString();
}

function quoteIdentifier(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Identificador SQL inválido: ${identifier}`);
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const databaseUrl = parseDatabaseUrl(process.env.DATABASE_URL);
const roleName = String(process.env.E2E_RLS_ROLE ?? 'alusa_app').trim();
const rolePassword = String(process.env.E2E_RLS_PASSWORD ?? 'alusa-e2e-rls-password').trim();

if (!rolePassword) throw new Error('E2E_RLS_PASSWORD não pode ser vazio.');

const role = quoteIdentifier(roleName);
const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();
  const existing = await client.query(
    'SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists',
    [roleName],
  );

  if (!existing.rows[0]?.exists) {
    await client.query(
      `CREATE ROLE ${role} LOGIN PASSWORD ${quoteLiteral(rolePassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
    );
  } else {
    // E2E must never silently reuse an elevated role.
    await client.query(
      `ALTER ROLE ${role} LOGIN PASSWORD ${quoteLiteral(rolePassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
    );
  }

  const roleState = await client.query(
    'SELECT rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1',
    [roleName],
  );
  const state = roleState.rows[0];
  if (!state?.rolcanlogin || state.rolsuper || state.rolbypassrls) {
    throw new Error('O papel RLS de E2E não está em modo least-privilege.');
  }

  const databaseName = (await client.query('SELECT current_database() AS name')).rows[0]?.name;
  if (!databaseName) throw new Error('Não foi possível resolver o banco do papel RLS de E2E.');

  // The migration grants these privileges when the role exists before deploy.
  // Repeating the idempotent grants also makes local reruns work when the role
  // is created after the database already has its migrations applied.
  await client.query(`CREATE SCHEMA IF NOT EXISTS app_security`);
  await client.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO ${role}`);
  await client.query(`GRANT USAGE ON SCHEMA public, app_security TO ${role}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
  await client.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
  await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, app_security TO ${role}`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${role}`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${role}`);

  const privileges = await client.query(
    `SELECT
       has_database_privilege($1, $2, 'CONNECT') AS can_connect,
       has_schema_privilege($1, 'public', 'USAGE') AS can_use_public,
       has_schema_privilege($1, 'app_security', 'USAGE') AS can_use_security,
       (SELECT count(*)::int FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'contaId' AND NOT a.attisdropped
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity) AS tenant_rls_tables`,
    [roleName, databaseName],
  );
  const privilegeState = privileges.rows[0];
  if (
    !privilegeState?.can_connect
    || !privilegeState.can_use_public
    || !privilegeState.can_use_security
    || Number(privilegeState.tenant_rls_tables ?? 0) < 1
  ) {
    throw new Error('Os privilégios ou a cobertura RLS de E2E não foram aplicados ao banco atual.');
  }

  const runtimeUrl = new URL(databaseUrl);
  runtimeUrl.username = roleName;
  runtimeUrl.password = rolePassword;
  const runtimeClient = new Client({ connectionString: runtimeUrl.toString() });
  try {
    await runtimeClient.connect();
    const runtimeState = await runtimeClient.query(
      `SELECT current_user AS current_user,
              current_database() AS current_database,
              app_security.current_conta_id() AS current_conta_id`,
    );
    const runtimeRow = runtimeState.rows[0];
    if (
      runtimeRow?.current_user !== roleName
      || runtimeRow.current_database !== databaseName
      || runtimeRow.current_conta_id !== null
    ) {
      throw new Error('A conexão de runtime RLS não iniciou com o banco ou contexto esperados.');
    }

    // O probe usa escopo de sessão porque o driver pode usar transações
    // distintas para cada query; o runtime real usa escopo transacional.
    await runtimeClient.query(`SELECT set_config('app.current_conta_id', $1, false)`, ['__e2e_rls_probe__']);
    const contextCheck = await runtimeClient.query('SELECT app_security.current_conta_id() AS current_conta_id');
    if (contextCheck.rows[0]?.current_conta_id !== '__e2e_rls_probe__') {
      throw new Error('O contexto app.current_conta_id não está disponível para o papel de runtime.');
    }
  } finally {
    await runtimeClient.end().catch(() => undefined);
  }

  console.log(`[e2e][rls] OK: papel ${roleName} preparado sem SUPERUSER/BYPASSRLS.`);
} finally {
  await client.end().catch(() => undefined);
}
