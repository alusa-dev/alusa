#!/usr/bin/env node

import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

function baseUrlForApiKey(apiKey) {
  const normalized = apiKey.trim().toLowerCase();
  if (normalized.startsWith('$aact_prod_')) return 'https://api.asaas.com/v3/';
  if (normalized.startsWith('$aact_hmlg_')) return 'https://api-sandbox.asaas.com/v3/';
  const configured = process.env.ASAAS_BASE_URL?.trim();
  if (configured) return configured.endsWith('/') ? configured : `${configured}/`;
  throw new Error(
    'Não foi possível inferir ambiente pela chave. Defina ASAAS_BASE_URL terminando em /v3/.',
  );
}

async function asaasFetch({ baseUrl, apiKey, path, method = 'GET', body }) {
  const url = new URL(path.replace(/^\//, ''), baseUrl);
  const response = await fetch(url, {
    method,
    headers: {
      access_token: apiKey,
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = json?.errors?.[0]?.description ?? json?.message ?? response.statusText;
    throw new Error(`Asaas ${response.status}: ${detail}`);
  }
  return json;
}

const rl = createInterface({ input, output });

try {
  const masterKey = (await rl.question('ASAAS_MASTER_KEY: ')).trim();
  const subaccountId = (await rl.question('SUBACCOUNT_ID: ')).trim();

  if (!masterKey) throw new Error('ASAAS_MASTER_KEY é obrigatório.');
  if (!subaccountId) throw new Error('SUBACCOUNT_ID é obrigatório.');

  const baseUrl = baseUrlForApiKey(masterKey);
  const tokenName = `Alusa suporte manual ${new Date().toISOString()}`;

  const created = await asaasFetch({
    baseUrl,
    apiKey: masterKey,
    path: `/accounts/${encodeURIComponent(subaccountId)}/accessTokens`,
    method: 'POST',
    body: { name: tokenName },
  });

  const apiKey = String(created?.apiKey ?? '').trim();
  if (!apiKey) throw new Error('A resposta do Asaas não retornou apiKey.');

  const remoteAccount = await asaasFetch({
    baseUrl: baseUrlForApiKey(apiKey),
    apiKey,
    path: '/myAccount',
  });

  if (remoteAccount?.id !== subaccountId) {
    throw new Error(
      `API Key gerada pertence à subconta ${remoteAccount?.id ?? 'desconhecida'}, não ${subaccountId}.`,
    );
  }

  output.write('\nAPI Key da subconta gerada e validada:\n');
  output.write(`${apiKey}\n`);
} catch (error) {
  output.write(`\nFalha: ${error instanceof Error ? error.message : 'erro desconhecido'}\n`);
  process.exitCode = 1;
} finally {
  rl.close();
}
