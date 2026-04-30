#!/usr/bin/env node

const { Client } = require('pg');

const connectionString = process.env.DATABASE_URL || process.env.DIRECT_URL;
if (!connectionString) {
  throw new Error('Missing required database configuration.');
}
const financeProfileId = 'cmkwwmok10034j141utlfpkqt';

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
  await client.connect();
  await client.query(
    'UPDATE "AsaasAccount" SET "documentsCache" = $1 WHERE "financeProfileId" = $2',
    [JSON.stringify(documentsCache), financeProfileId]
  );
  await client.end();
  console.log('Campo documentsCache atualizado com sucesso!');
}

main().catch(err => {
  console.error('Erro ao atualizar documentsCache:', err);
  process.exit(1);
});
