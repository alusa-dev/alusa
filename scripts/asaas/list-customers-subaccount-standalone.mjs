// Script standalone para descriptografar apiKeyEncrypted e listar customers da subconta Asaas
// Uso: node scripts/asaas/list-customers-subaccount-standalone.mjs <apiKeyEncrypted>
// Requer ENCRYPTION_KEY no .env ou exportada

import 'dotenv/config';
import crypto from 'crypto';
import fetch from 'node-fetch';

const LEGACY_PREFIX = 'v1:';
const PREFIX_V2 = 'v2:';

function getKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY não configurada');
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY inválida: esperado 32 bytes');
  return key;
}

function decryptSecret(encoded) {
  if (!encoded) return null;
  if (encoded.startsWith(LEGACY_PREFIX)) {
    const b64 = encoded.slice(LEGACY_PREFIX.length);
    try {
      return Buffer.from(b64, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }
  if (encoded.startsWith(PREFIX_V2)) {
    const key = getKey();
    const b64 = encoded.slice(PREFIX_V2.length);
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 12 + 16) return null;
    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return decrypted.toString('utf8');
    } catch {
      return null;
    }
  }
  // Compatibilidade legacy (packages/database): iv:salt:authTag:encrypted
  const parts = encoded.split(':');
  if (parts.length !== 4) return null;
  const [ivHex, , authTagHex, encryptedHex] = parts;
  if (!ivHex || !authTagHex || !encryptedHex) return null;
  try {
    const key = getKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}

const apiKeyEncrypted = process.argv[2];
const shouldDelete = process.argv.includes('--delete');
const customerIdArgIndex = process.argv.indexOf('--id');
const customerId = customerIdArgIndex >= 0 ? process.argv[customerIdArgIndex + 1] : null;
const BASE_URL = process.env.ASAAS_BASE_URL || 'https://sandbox.asaas.com/api/v3';

if (!apiKeyEncrypted) {
  console.error('Passe o apiKeyEncrypted como argumento.');
  process.exit(1);
}

const apiKey = decryptSecret(apiKeyEncrypted);
if (!apiKey) {
  console.error('Não foi possível descriptografar a chave. Verifique ENCRYPTION_KEY.');
  process.exit(1);
}

async function getAllCustomers() {
  let customers = [];
  let page = 0;
  let hasMore = true;
  while (hasMore) {
    const res = await fetch(`${BASE_URL}/customers?limit=100&offset=${page * 100}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await res.json();
    if (!data.data) break;
    customers = customers.concat(data.data);
    hasMore = data.hasMore;
    page++;
  }
  return customers;
}

async function getCustomerById(id, apiKey) {
  const res = await fetch(`${BASE_URL}/customers/${id}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function deleteCustomer(id, apiKey) {
  const res = await fetch(`${BASE_URL}/customers/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (res.status === 200 || res.status === 204) {
    console.log(`Removido: ${id}`);
  } else {
    const err = await res.text();
    console.error(`Erro ao remover ${id}:`, err);
  }
}

(async () => {
  if (customerId) {
    const result = await getCustomerById(customerId, apiKey);
    if (result.status === 200) {
      const c = result.data;
      console.log(`Encontrado: ID: ${c.id} | Nome: ${c.name} | CPF/CNPJ: ${c.cpfCnpj}`);
    } else {
      console.log(`Customer não encontrado nesta subconta. Status: ${result.status}`);
    }
    return;
  }
  const customers = await getAllCustomers();
  console.log(`Encontrados ${customers.length} customers na subconta.`);
  for (const c of customers) {
    console.log(`ID: ${c.id} | Nome: ${c.name} | CPF/CNPJ: ${c.cpfCnpj}`);
  }
  if (shouldDelete && customers.length) {
    for (const c of customers) {
      await deleteCustomer(c.id, apiKey);
      await new Promise((r) => setTimeout(r, 300));
    }
    console.log('Remoção concluída.');
  }
})();
