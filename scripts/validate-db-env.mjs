#!/usr/bin/env node

import process from 'node:process';
import net from 'node:net';

const mode = process.argv[2] === 'test' ? 'test' : 'dev';

function parseConnectionString(rawValue) {
  const value = String(rawValue ?? '').trim();
  if (!value) return null;

  try {
    const parsed = new URL(value);
    return {
      value,
      host: parsed.hostname.toLowerCase(),
      port: parsed.port || (parsed.protocol === 'postgresql:' ? '5432' : ''),
      databaseName: decodeURIComponent(parsed.pathname.replace(/^\/+/, '')).toLowerCase(),
    };
  } catch {
    return {
      value,
      host: '',
      port: '',
      databaseName: '',
    };
  }
}

function isProductionLike(connection) {
  if (!connection) return false;
  const haystack = `${connection.host} ${connection.databaseName} ${connection.value.toLowerCase()}`;
  return haystack.includes('alusa_prod') || connection.databaseName.endsWith('_prod');
}

function isTestLike(connection) {
  if (!connection) return false;
  return connection.databaseName.includes('test');
}

function isLocalConnection(connection) {
  if (!connection) return false;
  return connection.host === 'localhost' || connection.host === '127.0.0.1';
}

function fail(message) {
  console.error(`\n[db-env] ${message}\n`);
  process.exit(1);
}

function canConnect(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: Number(port), timeout: timeoutMs });

    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });

    const closeAsFailure = () => {
      socket.destroy();
      resolve(false);
    };

    socket.once('timeout', closeAsFailure);
    socket.once('error', closeAsFailure);
  });
}

const databaseUrl = parseConnectionString(process.env.DATABASE_URL);
const directUrl = parseConnectionString(process.env.DIRECT_URL);

if (!databaseUrl) {
  fail(`DATABASE_URL ausente para o modo ${mode}.`);
}

if (isProductionLike(databaseUrl) || isProductionLike(directUrl)) {
  fail('DATABASE_URL/DIRECT_URL aponta para produção. Troque para um banco local ou de teste antes de continuar.');
}

if (mode === 'test') {
  if (!isTestLike(databaseUrl)) {
    fail(`DATABASE_URL de teste precisa apontar para um banco *_test. Atual: ${databaseUrl.databaseName || databaseUrl.value}`);
  }
} else {
  if (isTestLike(databaseUrl)) {
    fail(
      `DATABASE_URL de desenvolvimento aponta para banco de teste (${databaseUrl.databaseName}). ` +
        'Isso costuma acontecer após rodar testes no mesmo terminal. Reinicie o shell ou use pnpm dev (com override de .env.local).',
    );
  }
  if (!isLocalConnection(databaseUrl) && process.env.ALLOW_REMOTE_DEV_DB !== 'true') {
    fail('DATABASE_URL de desenvolvimento precisa apontar para localhost/127.0.0.1. Use ALLOW_REMOTE_DEV_DB=true apenas para um banco remoto nao produtivo.');
  }
}

if (!(await canConnect(databaseUrl.host, databaseUrl.port || '5432'))) {
  fail(
    `Nao foi possivel conectar ao PostgreSQL em ${databaseUrl.host}:${databaseUrl.port || '5432'}.\n` +
      'Inicie o banco local antes de subir a Alusa e confirme se DATABASE_URL aponta para a porta correta.',
  );
}

console.log(`[db-env] OK (${mode}): ${databaseUrl.databaseName || databaseUrl.value} @ ${databaseUrl.host}:${databaseUrl.port || 'default'}`);
