// Script para listar todos os customers de uma subconta Asaas
// Uso: node scripts/asaas/list-customers-subaccount.mjs <apiKeyEncrypted>
// Requer ENCRYPTION_KEY no .env ou exportada

import 'dotenv/config';
import { decryptSecret } from '../../packages/lib/src/security/encryption.js';
import fetch from 'node-fetch';

const apiKeyEncrypted = process.argv[2];
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

(async () => {
  const customers = await getAllCustomers();
  console.log(`Encontrados ${customers.length} customers na subconta.`);
  for (const c of customers) {
    console.log(`ID: ${c.id} | Nome: ${c.name} | CPF/CNPJ: ${c.cpfCnpj}`);
  }
})();
