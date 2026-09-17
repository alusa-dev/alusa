#!/usr/bin/env node

import http from 'node:http';
import process from 'node:process';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const appPort = portIndex >= 0 ? args[portIndex + 1] : process.env.PORT ?? '3001';

if (!/^\d+$/.test(String(appPort))) throw new Error(`Porta inválida para o servidor E2E: ${appPort}`);

const values = new Map();
const expirations = new Map();
let redisServer;

function deleteIfExpired(key) {
  const expiresAt = expirations.get(key);
  if (expiresAt !== undefined && expiresAt <= Date.now()) {
    expirations.delete(key);
    values.delete(key);
  }
}

function getValue(key) {
  deleteIfExpired(key);
  return values.get(key) ?? null;
}

function setValue(key, value, ttlMs) {
  values.set(key, String(value));
  if (ttlMs !== undefined) expirations.set(key, Date.now() + ttlMs);
  else expirations.delete(key);
}

function scanKeys(pattern) {
  const prefix = String(pattern ?? '').replace(/\*+$/, '');
  return [...values.keys()].filter((key) => {
    deleteIfExpired(key);
    return key.startsWith(prefix);
  });
}

function runCommand(command) {
  const [rawName, ...rawArgs] = Array.isArray(command) ? command : [];
  const name = String(rawName ?? '').toUpperCase();
  const args = rawArgs.map(String);

  if (name === 'PING') return 'PONG';
  if (name === 'GET') return getValue(args[0]);

  if (name === 'DEL') {
    let deleted = 0;
    for (const key of args) {
      deleteIfExpired(key);
      if (values.delete(key)) {
        expirations.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  if (name === 'SETEX') {
    setValue(args[0], args[2], Number(args[1]) * 1000);
    return 'OK';
  }

  if (name === 'SET') {
    const key = args[0];
    const value = args[1];
    const hasNx = args.some((arg) => arg.toUpperCase() === 'NX');
    if (hasNx && getValue(key) !== null) return null;

    const ttlUnitIndex = args.findIndex((arg) => ['EX', 'PX'].includes(arg.toUpperCase()));
    const ttlUnit = ttlUnitIndex >= 0 ? args[ttlUnitIndex].toUpperCase() : null;
    const ttlValue = ttlUnitIndex >= 0 ? Number(args[ttlUnitIndex + 1]) : undefined;
    const ttlMs = ttlUnit === 'EX' ? ttlValue * 1000 : ttlUnit === 'PX' ? ttlValue : undefined;
    setValue(key, value, Number.isFinite(ttlMs) ? ttlMs : undefined);
    return 'OK';
  }

  if (name === 'SCAN') {
    const matchIndex = args.findIndex((arg) => arg.toUpperCase() === 'MATCH');
    const pattern = matchIndex >= 0 ? args[matchIndex + 1] : '*';
    // The E2E cache only needs a deterministic single-page scan.
    return ['0', scanKeys(pattern)];
  }

  if (name === 'INCR') {
    const key = args[0];
    const current = Number(getValue(key) ?? '0') + 1;
    setValue(key, current);
    return current;
  }

  if (name === 'PEXPIRE') {
    const key = args[0];
    if (getValue(key) === null) return 0;
    expirations.set(key, Date.now() + Number(args[1]));
    return 1;
  }

  if (name === 'PTTL') {
    const key = args[0];
    if (getValue(key) === null) return -2;
    const expiresAt = expirations.get(key);
    return expiresAt === undefined ? -1 : Math.max(0, expiresAt - Date.now());
  }

  if (name === 'EVAL') {
    const script = args[0] ?? '';
    const keyCount = Number(args[1] ?? '0');
    const keys = args.slice(2, 2 + keyCount);
    const scriptArgs = args.slice(2 + keyCount);

    // These are the two atomic scripts used by the production adapters:
    // fixed-window rate limiting and compare-and-delete lease release.
    if (script.includes('redis.call(\'INCR\'')) {
      const key = keys[0];
      const count = Number(getValue(key) ?? '0') + 1;
      if (count === 1) setValue(key, count, Number(scriptArgs[1]));
      else setValue(key, count, expirations.get(key) ? expirations.get(key) - Date.now() : undefined);
      const ttl = runCommand(['PTTL', key]);
      const limit = Number(scriptArgs[0]);
      return [count <= limit ? 1 : 0, Math.max(0, limit - count), Math.max(0, Number(ttl))];
    }

    if (script.includes("redis.call('GET'") && script.includes("redis.call('DEL'")) {
      const key = keys[0];
      if (getValue(key) === scriptArgs[0]) {
        runCommand(['DEL', key]);
        return 1;
      }
      return 0;
    }
  }

  throw new Error(`Comando Redis REST não suportado pelo emulador E2E: ${name}`);
}

function startRedisEmulator() {
  const token = process.env.E2E_REDIS_TOKEN ?? 'alusa-e2e-redis-token';
  redisServer = http.createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }

    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    let body = '';
    for await (const chunk of request) body += chunk;

    try {
      const result = runCommand(JSON.parse(body));
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ result }));
    } catch (error) {
      response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  return new Promise((resolve, reject) => {
    redisServer.once('error', reject);
    redisServer.listen(0, '127.0.0.1', () => {
      const address = redisServer.address();
      if (!address || typeof address === 'string') return reject(new Error('Não foi possível obter a porta do Redis E2E.'));
      process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${address.port}`;
      process.env.UPSTASH_REDIS_REST_TOKEN = token;
      resolve();
    });
  });
}

if (process.env.E2E_REDIS_EMULATOR === 'true') {
  process.env.ASAAS_REDIS_ENABLED = 'true';
  await startRedisEmulator();
} else if (!process.env.UPSTASH_REDIS_REST_URL?.trim() || !process.env.UPSTASH_REDIS_REST_TOKEN?.trim()) {
  throw new Error(
    'E2E production-like exige Redis REST real ou E2E_REDIS_EMULATOR=true explicitamente. Nenhum fallback em memória é habilitado pelo runner.',
  );
}

const child = spawn('pnpm', ['exec', 'next', 'start', '-p', String(appPort)], {
  stdio: 'inherit',
  env: process.env,
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  child.kill(signal);
  redisServer?.close();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

child.once('exit', (code, signal) => {
  redisServer?.close();
  process.exit(code ?? (signal ? 1 : 0));
});
