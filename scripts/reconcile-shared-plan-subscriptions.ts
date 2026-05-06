/**
 * Reconciliação: Subscriptions individuais indevidas para matrículas SHARED_PLAN.
 *
 * Cenário: bug no /api/contratos/route.ts criava assinatura individual (Subscription)
 * para matrículas em modo SHARED_PLAN (cobrança familiar). A cobrança deveria ser
 * exclusivamente via StandaloneSubscription do responsável financeiro.
 *
 * Este script:
 * 1. Encontra Subscription linked a Matricula com billingMode=SHARED_PLAN
 * 2. Cancela no Asaas (se asaasSubscriptionId existir)
 * 3. Atualiza status local para CANCELED
 *
 * Uso:
 *   npx tsx scripts/reconcile-shared-plan-subscriptions.ts --dry-run
 *   npx tsx scripts/reconcile-shared-plan-subscriptions.ts
 *   npx tsx scripts/reconcile-shared-plan-subscriptions.ts --contaId=xxx
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes('--dry-run');
const CONTA_ID_ARG = process.argv.find((a) => a.startsWith('--contaId='))?.split('=')[1];
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';

if (!ENCRYPTION_KEY) {
  console.error('❌ ENCRYPTION_KEY não definida.');
  process.exit(1);
}

function decrypt(encoded: string): string {
  const key = /^[0-9a-f]{64}$/i.test(ENCRYPTION_KEY)
    ? Buffer.from(ENCRYPTION_KEY, 'hex')
    : Buffer.from(ENCRYPTION_KEY, 'base64');
  const [ivHex, , authTagHex, encryptedHex] = encoded.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

const ASAAS_BASE = process.env.ASAAS_BASE_URL || 'https://api.asaas.com/v3';
const apiKeyCache = new Map<string, string>();

async function getApiKey(contaId: string): Promise<string | null> {
  if (apiKeyCache.has(contaId)) return apiKeyCache.get(contaId)!;
  const fp = await prisma.financeProfile.findUnique({
    where: { contaId },
    select: { asaasAccount: { select: { apiKeyEncrypted: true } } },
  });
  const encrypted = fp?.asaasAccount?.apiKeyEncrypted;
  if (!encrypted) return null;
  const key = decrypt(encrypted);
  apiKeyCache.set(contaId, key);
  return key;
}

async function cancelAsaasSubscription(apiKey: string, asaasSubscriptionId: string): Promise<boolean> {
  const url = `${ASAAS_BASE}/subscriptions/${asaasSubscriptionId}`;

  // read-before-write: verificar estado atual
  const getRes = await fetch(url, {
    headers: { access_token: apiKey, 'Content-Type': 'application/json' },
  });
  if (!getRes.ok) {
    console.warn(`    ⚠️  GET ${asaasSubscriptionId}: HTTP ${getRes.status}`);
    return false;
  }
  const current = await getRes.json() as { status?: string; deleted?: boolean };
  if (current.deleted || current.status === 'INACTIVE') {
    console.log(`    ℹ️  ${asaasSubscriptionId} já está cancelada/inativa no Asaas`);
    return true;
  }

  // DELETE
  const delRes = await fetch(url, {
    method: 'DELETE',
    headers: { access_token: apiKey, 'Content-Type': 'application/json' },
  });
  if (!delRes.ok) {
    console.warn(`    ⚠️  DELETE ${asaasSubscriptionId}: HTTP ${delRes.status}`);
    return false;
  }
  return true;
}

async function main() {
  console.log(`\n🔍 Reconciliação Subscription indevidas (SHARED_PLAN)${DRY_RUN ? ' [DRY-RUN]' : ''}\n`);

  const subscriptions = await prisma.subscription.findMany({
    where: {
      status: { not: 'CANCELED' },
      matricula: {
        billingMode: 'SHARED_PLAN',
        ...(CONTA_ID_ARG ? { aluno: { contaId: CONTA_ID_ARG } } : {}),
      },
    },
    select: {
      id: true,
      asaasSubscriptionId: true,
      matricula: {
        select: {
          id: true,
          billingMode: true,
          aluno: { select: { nome: true, contaId: true } },
        },
      },
    },
  });

  console.log(`📋 Subscriptions indevidas encontradas: ${subscriptions.length}`);

  if (subscriptions.length === 0) {
    console.log('✅ Nenhuma ação necessária.\n');
    return;
  }

  let canceled = 0;
  let errors = 0;

  for (const sub of subscriptions) {
    const contaId = sub.matricula.aluno.contaId;
    const alunoNome = sub.matricula.aluno.nome;
    console.log(`\n  Aluno: ${alunoNome} | Subscription: ${sub.id} | Asaas: ${sub.asaasSubscriptionId ?? '(sem ID Asaas)'}`);

    if (DRY_RUN) {
      console.log(`  ⏭️  [DRY-RUN] seria cancelada`);
      canceled++;
      continue;
    }

    try {
      // Cancelar no Asaas se tiver asaasSubscriptionId
      if (sub.asaasSubscriptionId) {
        const apiKey = await getApiKey(contaId);
        if (!apiKey) {
          console.warn(`  ⚠️  API key não encontrada para conta ${contaId}`);
          errors++;
          continue;
        }
        const ok = await cancelAsaasSubscription(apiKey, sub.asaasSubscriptionId);
        if (!ok) {
          console.warn(`  ⚠️  Falha ao cancelar no Asaas`);
          errors++;
          continue;
        }
        console.log(`  ✅ Cancelada no Asaas`);
      } else {
        console.log(`  ℹ️  Sem asaasSubscriptionId — cancelando apenas localmente`);
      }

      // Cancelar localmente
      await prisma.subscription.update({
        where: { id: sub.id },
        data: {
          status: 'CANCELED',
          statusUpdatedAt: new Date(),
        },
      });
      console.log(`  ✅ Status local atualizado para CANCELED`);
      canceled++;
    } catch (err) {
      console.error(`  ❌ Erro:`, err);
      errors++;
    }
  }

  console.log(
    `\n✅ Concluído.` +
    `\n   Canceladas: ${canceled}` +
    `\n   Erros: ${errors}\n`,
  );
}

main()
  .catch((err) => {
    console.error('❌ Erro fatal:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
