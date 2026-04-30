// Script para remover todos os customers do Asaas via API
// ATENÇÃO: Use apenas em ambiente controlado! Irreversível.
// Requer: node-fetch (pnpm add node-fetch)

import fetch from 'node-fetch';

const API_KEY = process.env.ASAAS_API_KEY;
const BASE_URL = process.env.ASAAS_BASE_URL || 'https://sandbox.asaas.com/api/v3';

if (!API_KEY) {
  console.error('Defina a variável de ambiente ASAAS_API_KEY');
  process.exit(1);
}

async function getAllCustomers() {
  let customers = [];
  let page = 0;
  let hasMore = true;
  while (hasMore) {
    const res = await fetch(`${BASE_URL}/customers?limit=100&offset=${page * 100}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    const data = await res.json();
    if (!data.data) break;
    customers = customers.concat(data.data);
    hasMore = data.hasMore;
    page++;
  }
  return customers;
}

async function deleteCustomer(id) {
  const res = await fetch(`${BASE_URL}/customers/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (res.status === 200 || res.status === 204) {
    console.log(`Removido: ${id}`);
  } else {
    const err = await res.text();
    console.error(`Erro ao remover ${id}:`, err);
  }
}

(async () => {
  const customers = await getAllCustomers();
  console.log(`Encontrados ${customers.length} customers.`);
  for (const c of customers) {
    await deleteCustomer(c.id);
    await new Promise((r) => setTimeout(r, 300)); // evita rate limit
  }
  console.log('Processo concluído.');
})();
