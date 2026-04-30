#!/usr/bin/env npx ts-node

/**
 * Script para recalcular e atualizar os webhookAuthTokenHash no banco
 * baseado no ASAAS_WEBHOOK_AUTH_TOKEN_SECRET atual.
 * 
 * Uso: pnpm tsx scripts/fix-webhook-auth-tokens.ts
 */

import { createHash, createHmac } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function deriveWebhookAuthToken(financeProfileId: string, secret: string): string {
  const digest = createHmac('sha256', secret)
    .update(`financeProfile:${financeProfileId}`)
    .digest('base64url');
  return digest;
}

function hashWebhookAuthToken(webhookAuthToken: string): string {
  return createHash('sha256').update(webhookAuthToken).digest('hex');
}

async function main() {
  const secret = process.env.ASAAS_WEBHOOK_AUTH_TOKEN_SECRET;
  
  if (!secret) {
    console.error('❌ ASAAS_WEBHOOK_AUTH_TOKEN_SECRET não configurada');
    process.exit(1);
  }

  console.log('🔑 Secret encontrada (primeiros 12 chars):', secret.slice(0, 12) + '...');

  const accounts = await prisma.asaasAccount.findMany({
    where: {
      asaasAccountId: { not: null },
    },
    select: {
      id: true,
      financeProfileId: true,
      asaasAccountId: true,
      webhookAuthTokenHash: true,
    },
  });

  console.log(`📦 Encontradas ${accounts.length} subcontas para verificar\n`);

  for (const account of accounts) {
    const expectedToken = deriveWebhookAuthToken(account.financeProfileId, secret);
    const expectedHash = hashWebhookAuthToken(expectedToken);

    console.log(`--- Subconta: ${account.asaasAccountId} ---`);
    console.log(`  FinanceProfile: ${account.financeProfileId}`);
    console.log(`  Hash atual:     ${account.webhookAuthTokenHash}`);
    console.log(`  Hash esperado:  ${expectedHash}`);

    if (account.webhookAuthTokenHash === expectedHash) {
      console.log(`  ✅ Hash já está correto\n`);
    } else {
      console.log(`  ⚠️  Hash diferente - atualizando...\n`);

      await prisma.asaasAccount.update({
        where: { id: account.id },
        data: { webhookAuthTokenHash: expectedHash },
      });

      console.log(`  ✅ Hash atualizado!\n`);
    }
  }

  console.log('✅ Concluído!');
  console.log('\n📝 IMPORTANTE: O webhook no Asaas continua enviando o token configurado na criação da subconta.');
  console.log('   Se o secret mudou APÓS a criação, você precisa atualizar o webhook no painel do Asaas');
  console.log('   ou recriar a subconta para sincronizar o token.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
