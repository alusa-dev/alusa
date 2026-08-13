#!/usr/bin/env node

import pg from 'pg';

const { Client } = pg;

const connectionString = process.env.DATABASE_URL || process.env.DIRECT_URL;
if (!connectionString) {
  throw new Error('Missing required database configuration.');
}

const financeProfileId = process.env.FINANCE_PROFILE_ID;
if (!financeProfileId) {
  throw new Error('Missing FINANCE_PROFILE_ID.');
}

if (process.env.CONFIRM_FORCE_DOCUMENTS_PENDING !== financeProfileId) {
  throw new Error(
    'Set CONFIRM_FORCE_DOCUMENTS_PENDING to the same value as FINANCE_PROFILE_ID to confirm this operation.'
  );
}

const documentsCache = {
  version: 1,
  documents: {
    data: [
      {
        id: '2cedbcef-9389-412e-acd6-4324a59cfadb',
        type: 'IDENTIFICATION',
        title: 'Documentos de identificação',
        status: 'NOT_SENT',
        documents: [],
        description: 'Para enviar esse documento acesse nosso aplicativo ou utilize o link de onboarding.',
        responsible: { name: 'BLEND', type: 'MEI' }
      },
      {
        id: '2cedbcef-9389-412e-acd6-4324a59cfadb',
        type: 'IDENTIFICATION_SELFIE',
        title: 'Selfie de identificação',
        status: 'NOT_SENT',
        documents: [],
        description: 'Para enviar esse documento acesse nosso aplicativo ou utilize o link de onboarding.',
        responsible: { name: 'BLEND', type: 'MEI' }
      }
    ],
    rejectReasons: null
  },
  myAccountStatus: {
    id: '911e275c-3640-46d3-bf9d-133f0a8d7363',
    general: 'PENDING',
    documentation: 'PENDING',
    commercialInfo: 'APPROVED',
    bankAccountInfo: 'APPROVED'
  }
};

async function main() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    await client.query('BEGIN');

    const financeProfileResult = await client.query(
      'SELECT id FROM "FinanceProfile" WHERE id = $1 FOR UPDATE',
      [financeProfileId]
    );
    if (financeProfileResult.rowCount !== 1) {
      throw new Error('FinanceProfile not found.');
    }

    const asaasAccountResult = await client.query(
      'UPDATE "AsaasAccount" SET "documentsCache" = $1 WHERE "financeProfileId" = $2',
      [JSON.stringify(documentsCache), financeProfileId]
    );
    if (asaasAccountResult.rowCount !== 1) {
      throw new Error('Expected exactly one AsaasAccount for the FinanceProfile.');
    }

    await client.query(
      'UPDATE "FinanceProfile" SET "isOnboardingCompleted" = false, "onboardingCompletedAt" = NULL WHERE id = $1',
      [financeProfileId]
    );
    await client.query('COMMIT');
    console.log('Pendência de envio de documentos forçada com sucesso.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch(err => {
  console.error('Erro ao atualizar documentsCache:', err);
  process.exit(1);
});
