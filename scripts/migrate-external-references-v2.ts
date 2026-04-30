/**
 * Script de migração: externalReference V1 → V2
 * 
 * Este script atualiza os registros existentes para usar o novo formato
 * de externalReference (V2) que inclui informações de rastreabilidade.
 * 
 * V1 (legado):
 *   - subscription:{subscriptionId}
 *   - installmentPlan:{planId}
 *   - standalone:{chargeId}
 * 
 * V2 (novo):
 *   - alusa:subscription:{matriculaId}:{planoId}:{subcontaId}
 *   - alusa:installment:{installmentPlanId}:{subcontaId}
 *   - alusa:standalone:{chargeId}:{subcontaId}
 * 
 * IMPORTANTE:
 * - Execute em ambiente de staging/dev antes de produção
 * - Faça backup antes de executar
 * - O script é idempotente (pode ser executado múltiplas vezes)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface MigrationStats {
  subscriptions: { total: number; migrated: number; skipped: number; errors: number };
  installmentPlans: { total: number; migrated: number; skipped: number; errors: number };
  charges: { total: number; migrated: number; skipped: number; errors: number };
}

function buildSubscriptionV2Ref(matriculaId: string, planoId: string, contaId: string): string {
  return `alusa:subscription:${matriculaId}:${planoId}:${contaId}`;
}

function buildInstallmentV2Ref(installmentPlanId: string, contaId: string): string {
  return `alusa:installment:${installmentPlanId}:${contaId}`;
}

function buildStandaloneV2Ref(chargeId: string, contaId: string): string {
  return `alusa:standalone:${chargeId}:${contaId}`;
}

function isV2Format(ref: string | null): boolean {
  return ref?.startsWith('alusa:') ?? false;
}

async function migrateSubscriptions(dryRun: boolean): Promise<MigrationStats['subscriptions']> {
  const stats = { total: 0, migrated: 0, skipped: 0, errors: 0 };

  const subscriptions = await prisma.subscription.findMany({
    where: {
      externalReference: { not: null },
    },
    select: {
      id: true,
      externalReference: true,
      contaId: true,
      matriculaId: true,
      matricula: {
        select: {
          planoId: true,
        },
      },
    },
  });

  stats.total = subscriptions.length;

  for (const sub of subscriptions) {
    if (!sub.externalReference || isV2Format(sub.externalReference)) {
      stats.skipped++;
      continue;
    }

    const planoId = sub.matricula?.planoId;
    if (!planoId) {
      console.warn(`⚠️ Subscription ${sub.id} sem planoId associado`);
      stats.errors++;
      continue;
    }

    const newRef = buildSubscriptionV2Ref(sub.matriculaId, planoId, sub.contaId);

    if (dryRun) {
      console.log(`[DRY-RUN] Subscription ${sub.id}: ${sub.externalReference} → ${newRef}`);
      stats.migrated++;
      continue;
    }

    try {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { externalReference: newRef },
      });
      stats.migrated++;
    } catch (error) {
      console.error(`❌ Erro ao migrar Subscription ${sub.id}:`, error);
      stats.errors++;
    }
  }

  return stats;
}

async function migrateInstallmentPlans(dryRun: boolean): Promise<MigrationStats['installmentPlans']> {
  const stats = { total: 0, migrated: 0, skipped: 0, errors: 0 };

  const plans = await prisma.installmentPlan.findMany({
    where: {
      externalReference: { not: null },
    },
    select: {
      id: true,
      externalReference: true,
      contaId: true,
    },
  });

  stats.total = plans.length;

  for (const plan of plans) {
    if (!plan.externalReference || isV2Format(plan.externalReference)) {
      stats.skipped++;
      continue;
    }

    const newRef = buildInstallmentV2Ref(plan.id, plan.contaId);

    if (dryRun) {
      console.log(`[DRY-RUN] InstallmentPlan ${plan.id}: ${plan.externalReference} → ${newRef}`);
      stats.migrated++;
      continue;
    }

    try {
      await prisma.installmentPlan.update({
        where: { id: plan.id },
        data: { externalReference: newRef },
      });
      stats.migrated++;
    } catch (error) {
      console.error(`❌ Erro ao migrar InstallmentPlan ${plan.id}:`, error);
      stats.errors++;
    }
  }

  return stats;
}

async function migrateStandaloneCharges(dryRun: boolean): Promise<MigrationStats['charges']> {
  const stats = { total: 0, migrated: 0, skipped: 0, errors: 0 };

  const charges = await prisma.charge.findMany({
    where: {
      externalReference: { not: null },
      // Apenas standalone (sem vínculo com cobrança acadêmica)
      cobrancaId: null,
    },
    select: {
      id: true,
      externalReference: true,
      contaId: true,
    },
  });

  stats.total = charges.length;

  for (const charge of charges) {
    if (!charge.externalReference || isV2Format(charge.externalReference)) {
      stats.skipped++;
      continue;
    }

    const newRef = buildStandaloneV2Ref(charge.id, charge.contaId);

    if (dryRun) {
      console.log(`[DRY-RUN] Charge ${charge.id}: ${charge.externalReference} → ${newRef}`);
      stats.migrated++;
      continue;
    }

    try {
      await prisma.charge.update({
        where: { id: charge.id },
        data: { externalReference: newRef },
      });
      stats.migrated++;
    } catch (error) {
      console.error(`❌ Erro ao migrar Charge ${charge.id}:`, error);
      stats.errors++;
    }
  }

  return stats;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('           Migração externalReference V1 → V2');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Modo: ${dryRun ? 'DRY-RUN (sem alterações)' : 'EXECUÇÃO REAL'}`);
  console.log('');

  if (!dryRun) {
    console.log('⚠️  ATENÇÃO: Este script irá modificar o banco de dados!');
    console.log('   Certifique-se de ter feito backup antes de continuar.');
    console.log('   Pressione Ctrl+C para cancelar ou aguarde 5 segundos...');
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  console.log('');
  console.log('Migrando Subscriptions...');
  const subStats = await migrateSubscriptions(dryRun);
  console.log(`  Total: ${subStats.total} | Migrados: ${subStats.migrated} | Ignorados: ${subStats.skipped} | Erros: ${subStats.errors}`);

  console.log('');
  console.log('Migrando InstallmentPlans...');
  const planStats = await migrateInstallmentPlans(dryRun);
  console.log(`  Total: ${planStats.total} | Migrados: ${planStats.migrated} | Ignorados: ${planStats.skipped} | Erros: ${planStats.errors}`);

  console.log('');
  console.log('Migrando Standalone Charges...');
  const chargeStats = await migrateStandaloneCharges(dryRun);
  console.log(`  Total: ${chargeStats.total} | Migrados: ${chargeStats.migrated} | Ignorados: ${chargeStats.skipped} | Erros: ${chargeStats.errors}`);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                          RESUMO');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Subscriptions:     ${subStats.migrated}/${subStats.total}`);
  console.log(`InstallmentPlans:  ${planStats.migrated}/${planStats.total}`);
  console.log(`Charges:           ${chargeStats.migrated}/${chargeStats.total}`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (dryRun) {
    console.log('');
    console.log('ℹ️  Execute sem --dry-run para aplicar as migrações.');
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('Erro fatal:', error);
  process.exit(1);
});
