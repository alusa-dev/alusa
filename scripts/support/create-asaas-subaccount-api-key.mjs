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

function accessTokensFromResponse(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  return [];
}

function tokenLabel(token, index) {
  const id = token?.id ?? `#${index + 1}`;
  const name = token?.name ?? 'sem nome';
  const enabled =
    typeof token?.enabled === 'boolean'
      ? token.enabled
        ? 'habilitada'
        : 'desabilitada'
      : 'status n/d';
  const expires = token?.expirationDate ?? token?.dateExpiration ?? 'sem expiração informada';
  const created = token?.dateCreated ?? 'criação n/d';
  return `${index + 1}. id=${id} | ${name} | ${enabled} | expiração=${expires} | criada=${created}`;
}

function getRemoteAccountId(remoteAccount) {
  return (
    remoteAccount?.id ??
    remoteAccount?.accountId ??
    remoteAccount?.asaasAccountId ??
    remoteAccount?.walletId ??
    null
  );
}

function normalizeDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function getAccountDocument(account) {
  return normalizeDigits(account?.cpfCnpj ?? account?.cpf ?? account?.cnpj);
}

function safeObjectKeys(value) {
  if (!value || typeof value !== 'object') return [];
  return Object.keys(value).sort();
}

function validateGeneratedKeyBelongsToSubaccount({
  remoteAccount,
  expectedSubaccount,
  subaccountId,
}) {
  const remoteAccountId = getRemoteAccountId(remoteAccount);
  if (remoteAccountId) {
    return {
      ok: remoteAccountId === subaccountId,
      method: 'id',
      detail: remoteAccountId,
    };
  }

  const expectedDocument = getAccountDocument(expectedSubaccount);
  const remoteDocument = getAccountDocument(remoteAccount);
  if (expectedDocument && remoteDocument) {
    return {
      ok: expectedDocument === remoteDocument,
      method: 'cpfCnpj',
      detail: expectedDocument === remoteDocument ? 'documento confere' : 'documento diverge',
    };
  }

  const expectedEmail = String(expectedSubaccount?.email ?? '')
    .trim()
    .toLowerCase();
  const remoteEmail = String(remoteAccount?.email ?? '')
    .trim()
    .toLowerCase();
  if (expectedEmail && remoteEmail) {
    return {
      ok: expectedEmail === remoteEmail,
      method: 'email',
      detail: expectedEmail === remoteEmail ? 'email confere' : 'email diverge',
    };
  }

  return {
    ok: false,
    method: 'unavailable',
    detail: remoteAccountId ?? 'desconhecida',
  };
}

function isYes(value) {
  const normalized = value.trim().toLowerCase();
  return normalized === 'y' || normalized === 'yes' || normalized === 's' || normalized === 'sim';
}

const rl = createInterface({ input, output });

try {
  const masterKey = (await rl.question('ASAAS_MASTER_KEY: ')).trim();
  const subaccountId = (await rl.question('SUBACCOUNT_ID: ')).trim();

  if (!masterKey) throw new Error('ASAAS_MASTER_KEY é obrigatório.');
  if (!subaccountId) throw new Error('SUBACCOUNT_ID é obrigatório.');

  const baseUrl = baseUrlForApiKey(masterKey);
  const tokenName = `Alusa suporte manual ${new Date().toISOString()}`;

  output.write('\nLendo dados da subconta esperada...\n');
  const expectedSubaccount = await asaasFetch({
    baseUrl,
    apiKey: masterKey,
    path: `/accounts/${encodeURIComponent(subaccountId)}`,
  });

  output.write('\nListando chaves de API existentes da subconta...\n');
  const listed = await asaasFetch({
    baseUrl,
    apiKey: masterKey,
    path: `/accounts/${encodeURIComponent(subaccountId)}/accessTokens`,
  });

  const existingTokens = accessTokensFromResponse(listed).filter((token) => token?.id);

  if (existingTokens.length > 0) {
    output.write('\nChaves encontradas (a API do Asaas não retorna o segredo antigo):\n');
    existingTokens.forEach((token, index) => output.write(`${tokenLabel(token, index)}\n`));

    const confirmation = (
      await rl.question(
        `\nRevogar ${existingTokens.length} chave(s) existente(s) e gerar uma nova? Digite Y para confirmar ou N para cancelar: `,
      )
    ).trim();

    if (!isYes(confirmation)) {
      throw new Error('Operação cancelada. Nenhuma chave foi criada ou excluída.');
    }

    for (const token of existingTokens) {
      await asaasFetch({
        baseUrl,
        apiKey: masterKey,
        path: `/accounts/${encodeURIComponent(subaccountId)}/accessTokens/${encodeURIComponent(token.id)}`,
        method: 'DELETE',
      });
      output.write(`Chave ${token.id} excluída.\n`);
    }

    const remaining = accessTokensFromResponse(
      await asaasFetch({
        baseUrl,
        apiKey: masterKey,
        path: `/accounts/${encodeURIComponent(subaccountId)}/accessTokens`,
      }),
    ).filter((token) => token?.id);

    if (remaining.length > 0) {
      output.write('\nAinda existem chaves cadastradas nesta subconta:\n');
      remaining.forEach((token, index) => output.write(`${tokenLabel(token, index)}\n`));
      throw new Error(
        'Revogue todas as chaves existentes antes de criar uma nova para esta subconta WhiteLabel.',
      );
    }
  } else {
    output.write('Nenhuma chave existente encontrada.\n');
  }

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

  const validation = validateGeneratedKeyBelongsToSubaccount({
    remoteAccount,
    expectedSubaccount,
    subaccountId,
  });

  if (!validation.ok) {
    output.write('\n/myAccount não retornou o identificador esperado.\n');
    output.write(`Campos recebidos: ${safeObjectKeys(remoteAccount).join(', ') || 'nenhum'}\n`);
    output.write(`Método de validação tentado: ${validation.method} (${validation.detail}).\n`);
    throw new Error(
      `Não foi possível confirmar que a API Key gerada pertence à subconta ${subaccountId}.`,
    );
  }

  output.write(`Validação concluída por ${validation.method}: ${validation.detail}.\n`);
  output.write('\nAPI Key da subconta gerada, rotacionada e validada:\n');
  output.write(`${apiKey}\n`);
} catch (error) {
  output.write(`\nFalha: ${error instanceof Error ? error.message : 'erro desconhecido'}\n`);
  process.exitCode = 1;
} finally {
  rl.close();
}
