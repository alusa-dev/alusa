#!/usr/bin/env node
/**
 * Sandbox: credita saldo disponível na subconta via fluxo oficial Asaas
 * (criar cliente + cobrança PIX + POST /v3/sandbox/payment/{id}/confirm).
 *
 * Não existe endpoint de "injetar saldo"; ver:
 * https://docs.asaas.com/docs/adding-balance-to-a-sandbox-account
 *
 * Uso (na raiz do repo, com .env.local contendo DATABASE_URL, ENCRYPTION_KEY, ASAAS_BASE_URL):
 *
 *   pnpm exec dotenv -e .env.local -- node scripts/asaas/sandbox-add-wallet-balance.mjs --email=user@exemplo.com --value=1000
 *
 * O GET /finance/balance reflete valor líquido (taxas Asaas); R$ 1.000,00 na cobrança
 * pode aparecer como ~R$ 999,01 de saldo.
 *
 * Opcional: --contaId=<uuid> em vez de --email
 */

import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const { decryptSecret } = require('../../packages/database/src/security/encryption.ts');

const prisma = new PrismaClient();

function parseArgs() {
  const out = { email: null, contaId: null, value: 1000 };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--email=')) out.email = a.slice('--email='.length);
    else if (a.startsWith('--contaId=')) out.contaId = a.slice('--contaId='.length);
    else if (a.startsWith('--value=')) out.value = Number(a.slice('--value='.length));
  }
  return out;
}

function asaasBase() {
  const raw = process.env.ASAAS_BASE_URL?.trim() || 'https://api-sandbox.asaas.com/v3';
  return raw.endsWith('/') ? raw : `${raw}/`;
}

async function asaasFetch(apiKey, path, { method = 'GET', body } = {}) {
  const url = new URL(path.replace(/^\//, ''), asaasBase());
  const headers = {
    access_token: apiKey,
    Accept: 'application/json',
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
  };
  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text };
  }
  if (!res.ok) {
    const err = new Error(`Asaas ${method} ${path} -> ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

/** CPF válido só para ambiente de testes / geração local (algoritmo módulo 11). */
function randomValidCpf() {
  const n = [];
  for (let i = 0; i < 9; i++) n.push(Math.floor(Math.random() * 10));
  let d1 = 0;
  for (let i = 0; i < 9; i++) d1 += n[i] * (10 - i);
  d1 = 11 - (d1 % 11);
  if (d1 >= 10) d1 = 0;
  n.push(d1);
  let d2 = 0;
  for (let i = 0; i < 10; i++) d2 += n[i] * (11 - i);
  d2 = 11 - (d2 % 11);
  if (d2 >= 10) d2 = 0;
  n.push(d2);
  return n.join('');
}

async function resolveContaId({ email, contaId }) {
  if (contaId) return contaId;
  if (!email) throw new Error('Informe --email= ou --contaId=');
  const u = await prisma.usuario.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { contaId: true },
  });
  if (!u) throw new Error(`Usuario não encontrado: ${email}`);
  return u.contaId;
}

async function loadSubaccountApiKey(contaId) {
  const fp = await prisma.financeProfile.findUnique({
    where: { contaId },
    include: { asaasAccount: { select: { apiKeyEncrypted: true, apiKeyStatus: true } } },
  });
  const enc = fp?.asaasAccount?.apiKeyEncrypted;
  const apiKey = enc ? decryptSecret(enc) : null;
  if (!apiKey || fp?.asaasAccount?.apiKeyStatus !== 'CONNECTED') {
    throw new Error('AsaasAccount sem apiKey descriptografável ou status != CONNECTED');
  }
  return apiKey;
}

async function main() {
  const { email, contaId, value } = parseArgs();
  if (!Number.isFinite(value) || value <= 0) throw new Error('--value inválido');

  const resolvedContaId = await resolveContaId({ email, contaId });
  const apiKey = await loadSubaccountApiKey(resolvedContaId);

  const balanceBefore = await asaasFetch(apiKey, 'finance/balance');
  console.log('Saldo antes:', JSON.stringify(balanceBefore));

  const cpf = randomValidCpf();
  const customer = await asaasFetch(apiKey, 'customers', {
    method: 'POST',
    body: {
      name: 'Sandbox saldo (Alusa)',
      cpfCnpj: cpf,
      email: `sandbox-balance+${Date.now()}@alusa.invalid`,
    },
  });

  const due = new Date().toISOString().slice(0, 10);
  const payment = await asaasFetch(apiKey, 'payments', {
    method: 'POST',
    body: {
      customer: customer.id,
      billingType: 'PIX',
      value,
      dueDate: due,
      description: 'Crédito de teste sandbox (saldo)',
      externalReference: `alusa_sandbox_wallet_${Date.now()}`,
    },
  });

  console.log('Cobrança criada:', payment.id, 'status', payment.status);

  await asaasFetch(apiKey, `sandbox/payment/${payment.id}/confirm`, {
    method: 'POST',
    body: {},
  });

  const paymentAfter = await asaasFetch(apiKey, `payments/${payment.id}`);
  console.log('Pagamento após confirm:', paymentAfter.status, 'netValue', paymentAfter.netValue, 'creditDate', paymentAfter.creditDate);

  const balanceAfter = await asaasFetch(apiKey, 'finance/balance');
  console.log('Saldo depois:', JSON.stringify(balanceAfter));
}

main()
  .catch((e) => {
    console.error(e.message);
    if (e.body) console.error(JSON.stringify(e.body));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
