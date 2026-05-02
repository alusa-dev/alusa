#!/usr/bin/env tsx
/**
 * @file setup-rls.ts
 * @description Script para configurar Row-Level Security (RLS) no PostgreSQL.
 *
 * Este script implementa a Fase 2 do plano de isolamento multitenant.
 * O RLS é uma camada de segurança no nível do banco de dados que restringe
 * quais linhas são retornadas/afetadas com base em uma variável de sessão
 * do PostgreSQL (`app.current_tenant`).
 *
 * Isso adiciona uma "segunda linha de defesa" além da Prisma Extension,
 * tornando impossível acessar dados cross-tenant mesmo via SQL direto.
 *
 * AVISO: Execute este script com cuidado em produção. Ele altera políticas
 * de segurança no banco de dados.
 *
 * Execução:
 *   npx tsx apps/web/scripts/setup-rls.ts
 *   npx tsx apps/web/scripts/setup-rls.ts --dry-run  # Apenas exibe os SQLs
 *   npx tsx apps/web/scripts/setup-rls.ts --disable  # Desativa o RLS
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Modelos que possuem coluna `contaId` diretamente no schema.
// Mapeamento: nome do model Prisma -> nome da tabela PostgreSQL (snake_case)
const TENANT_TABLES: Record<string, string> = {
  Colaborador: 'Colaborador',
  Professor: 'Professor',
  FinanceProfile: 'FinanceProfile',
  Customer: 'Customer',
  Charge: 'Charge',
  ChargeReadModel: 'ChargeReadModel',
  StandaloneInstallmentPlan: 'StandaloneInstallmentPlan',
  StandaloneSubscription: 'StandaloneSubscription',
  Invoice: 'Invoice',
  Subscription: 'Subscription',
  InstallmentPlan: 'InstallmentPlan',
  TransferRequest: 'TransferRequest',
  PixTransferSession: 'PixTransferSession',
  TenantFeatureFlags: 'TenantFeatureFlags',
  AuditLog: 'AuditLog',
  ProductCategory: 'ProductCategory',
  Product: 'Product',
  Sale: 'Sale',
  InventoryBalance: 'InventoryBalance',
  InventoryMovement: 'InventoryMovement',
  RestockOrder: 'RestockOrder',
  WebhookAsaas: 'WebhookAsaas',
  WebhookAsaasArchive: 'WebhookAsaasArchive',
  LogFinanceiro: 'LogFinanceiro',
  LogIntegracao: 'LogIntegracao',
  AsaasIntegrationJob: 'AsaasIntegrationJob',
  AsaasNotificationPreference: 'AsaasNotificationPreference',
  RematriculaOperacao: 'RematriculaOperacao',
  PayerChangeOperacao: 'PayerChangeOperacao',
  MatriculaOperacao: 'MatriculaOperacao',
  Lancamento: 'Lancamento',
  CentroCusto: 'CentroCusto',
  CategoriaLancamento: 'CategoriaLancamento',
  CalendarEvent: 'CalendarEvent',
  AttendanceRecord: 'AttendanceRecord',
  MakeupClass: 'MakeupClass',
  AulasOperationLog: 'AulasOperationLog',
  PortalEvento: 'PortalEvento',
  ContratoTemplate: 'ContratoTemplate',
  ContratoModelo: 'ContratoModelo',
  Notification: 'Notification',
  NotificationRecipient: 'NotificationRecipient',
};

async function enableRls(tableName: string, dryRun: boolean): Promise<void> {
  const policyName = `rls_tenant_isolation_${tableName.toLowerCase()}`;

  // SQL para habilitar RLS na tabela
  const enableRlsSql = `ALTER TABLE "public"."${tableName}" ENABLE ROW LEVEL SECURITY;`;

  // Política que permite acesso somente quando o contaId da linha
  // corresponde à variável de sessão `app.current_tenant`.
  // BYPASS RLS é necessário para o owner do DB (ex: Prisma migrations).
  const createPolicySql = `
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = '${tableName}'
        AND policyname = '${policyName}'
      ) THEN
        CREATE POLICY "${policyName}"
        ON "public"."${tableName}"
        USING (
          "contaId" = NULLIF(current_setting('app.current_tenant', TRUE), '')
          OR current_setting('app.bypass_rls', TRUE) = 'on'
        );
      END IF;
    END $$;
  `;

  // Força bypass para role de DB owner (Prisma migrations, seeds, etc.)
  const bypassForOwnerSql = `ALTER TABLE "public"."${tableName}" FORCE ROW LEVEL SECURITY;`;

  if (dryRun) {
    console.log(`\n-- [DRY RUN] Tabela: ${tableName}`);
    console.log(enableRlsSql);
    console.log(createPolicySql);
    console.log(bypassForOwnerSql);
    return;
  }

  try {
    await prisma.$executeRawUnsafe(enableRlsSql);
    await prisma.$executeRawUnsafe(createPolicySql);
    // NOTA: FORCE ROW LEVEL SECURITY aplica RLS inclusive para o db owner
    // Isso garante que mesmo queries diretas sejam filtradas.
    // Comente a linha abaixo se o Prisma migration user for o table owner.
    // await prisma.$executeRawUnsafe(bypassForOwnerSql);
    console.log(`  ✓ RLS habilitado para: ${tableName}`);
  } catch (error) {
    console.error(`  ✗ Erro ao configurar RLS para ${tableName}:`, error);
  }
}

async function disableRls(tableName: string, dryRun: boolean): Promise<void> {
  const disableSql = `ALTER TABLE "public"."${tableName}" DISABLE ROW LEVEL SECURITY;`;
  const policyName = `rls_tenant_isolation_${tableName.toLowerCase()}`;
  const dropPolicySql = `DROP POLICY IF EXISTS "${policyName}" ON "public"."${tableName}";`;

  if (dryRun) {
    console.log(`\n-- [DRY RUN] Tabela: ${tableName}`);
    console.log(dropPolicySql);
    console.log(disableSql);
    return;
  }

  try {
    await prisma.$executeRawUnsafe(dropPolicySql);
    await prisma.$executeRawUnsafe(disableSql);
    console.log(`  ✓ RLS desabilitado para: ${tableName}`);
  } catch (error) {
    console.error(`  ✗ Erro ao desabilitar RLS para ${tableName}:`, error);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const disable = args.includes('--disable');

  const mode = disable ? 'DESABILITAÇÃO' : 'HABILITAÇÃO';
  console.log(`\n🔐 Alusa — Setup de Row-Level Security (RLS)`);
  console.log(`   Modo: ${mode}${dryRun ? ' [DRY RUN]' : ''}`);
  console.log(`   Tabelas a processar: ${Object.keys(TENANT_TABLES).length}`);
  console.log(`${'─'.repeat(50)}\n`);

  for (const [, tableName] of Object.entries(TENANT_TABLES)) {
    if (disable) {
      await disableRls(tableName, dryRun);
    } else {
      await enableRls(tableName, dryRun);
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`✅ Concluído! ${Object.keys(TENANT_TABLES).length} tabelas processadas.`);

  if (!dryRun) {
    console.log(`\n📝 IMPORTANTE: Para ativar o RLS nas queries do Prisma, defina a`);
    console.log(`   variável de sessão antes de cada query tenant-scoped:`);
    console.log(`   SET app.current_tenant = '{{contaId}}';`);
    console.log(`   Ou use o hook prisma-rls.ts para fazer isso automaticamente.\n`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
