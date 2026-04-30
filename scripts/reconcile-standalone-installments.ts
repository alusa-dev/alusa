/**
 * Script de Reconciliação de Parcelamentos Standalone
 *
 * Busca installments no Asaas que não possuem StandaloneInstallmentPlan local
 * e cria os registros necessários (Plan + Charges + ReadModel).
 *
 * Uso: npx tsx scripts/reconcile-standalone-installments.ts [--dry-run]
 */

import { PrismaClient, type ChargeStatus } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error('Missing required encryption configuration.');
}

const isDryRun = process.argv.includes('--dry-run');
const ASAAS_BASE_URL = 'https://api-sandbox.asaas.com/v3';

function decrypt(encoded: string): string {
  const raw = ENCRYPTION_KEY;
  const key = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');
  const [ivHex, , authTagHex, encryptedHex] = encoded.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

interface AsaasInstallment {
  id: string;
  paymentCount: number;
  billingType: string;
  value: number;
}

interface AsaasPayment {
  id: string;
  customer: string;
  value: number;
  dueDate: string;
  billingType: string;
  description?: string;
  externalReference?: string;
  status: string;
  installmentNumber?: number;
  invoiceUrl?: string;
}

const STATUS_MAP: Record<string, ChargeStatus> = {
  PENDING: 'OPEN',
  RECEIVED: 'PAID',
  CONFIRMED: 'PAID',
  RECEIVED_IN_CASH: 'PAID',
  OVERDUE: 'OVERDUE',
  REFUNDED: 'REFUNDED',
  REFUND_REQUESTED: 'REFUNDED',
  REFUND_IN_PROGRESS: 'REFUNDED',
  CHARGEBACK_REQUESTED: 'REFUNDED',
  CHARGEBACK_DISPUTE: 'REFUNDED',
  AWAITING_CHARGEBACK_REVERSAL: 'OPEN',
  DUNNING_REQUESTED: 'OVERDUE',
  DUNNING_RECEIVED: 'PAID',
  AWAITING_RISK_ANALYSIS: 'OPEN',
  DELETED: 'CANCELED',
};

function mapStatus(asaasStatus: string): ChargeStatus {
  return STATUS_MAP[asaasStatus] || 'CREATED';
}

async function fetchJson<T>(url: string, apiKey: string): Promise<T> {
  const res = await fetch(url, {
    headers: { access_token: apiKey, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} at ${url}`);
  return res.json() as Promise<T>;
}

async function main() {
  console.log('🔄 Reconciliação de Standalone Installments');
  console.log(isDryRun ? '📋 DRY-RUN' : '⚡ EXECUÇÃO REAL');
  console.log('');

  const accounts = await prisma.asaasAccount.findMany({
    where: { apiKeyEncrypted: { not: null }, apiKeyStatus: 'CONNECTED' },
    include: {
      financeProfile: {
        include: { conta: { select: { id: true, nome: true } } },
      },
    },
  });

  let totalCreated = 0;
  let totalSkipped = 0;
  let totalOrphans = 0;

  for (const account of accounts) {
    const contaId = account.financeProfile.conta.id;
    const contaNome = account.financeProfile.conta.nome;

    let apiKey: string;
    try {
      apiKey = decrypt(account.apiKeyEncrypted!);
    } catch {
      console.error(`❌ Erro ao descriptografar key para ${contaNome}`);
      continue;
    }

    console.log(`\n🏢 Conta: ${contaNome} (${contaId})`);

    // Buscar TODOS os installments do Asaas
    const installmentsRes = await fetchJson<{
      data: AsaasInstallment[];
      hasMore: boolean;
      totalCount: number;
    }>(`${ASAAS_BASE_URL}/installments?limit=100&offset=0`, apiKey);

    console.log(`   📦 ${installmentsRes.totalCount} installments no Asaas`);

    for (const inst of installmentsRes.data) {
      // Verificar se já existe localmente
      const existing = await prisma.standaloneInstallmentPlan.findFirst({
        where: { asaasInstallmentId: inst.id },
        select: { id: true, customerId: true, externalReference: true },
      });

      if (existing) {
        // Verificar se as charges existem
        const chargeCount = await prisma.charge.count({
          where: { standaloneInstallmentPlanId: existing.id },
        });

        if (chargeCount >= inst.paymentCount) {
          console.log(`   ✅ ${inst.id} → já existe (${existing.id}) com ${chargeCount} charges`);
          totalSkipped++;
          continue;
        }

        // Plan existe mas charges faltam — sincronizar
        console.log(`   🔄 ${inst.id} → plan existe (${existing.id}) mas faltam charges (${chargeCount}/${inst.paymentCount})`);

        const paymentsRes = await fetchJson<{ data: AsaasPayment[] }>(
          `${ASAAS_BASE_URL}/installments/${inst.id}/payments?limit=100&offset=0`,
          apiKey
        );

        if (!isDryRun) {
          for (const payment of paymentsRes.data) {
            const chargeExtRef = `${existing.externalReference}:payment:${payment.id}`;
            await prisma.charge.upsert({
              where: { asaasPaymentId: payment.id },
              update: {
                externalReference: chargeExtRef,
                status: mapStatus(payment.status),
                statusUpdatedAt: new Date(),
                description: payment.description ?? null,
                value: payment.value,
                dueDate: new Date(`${payment.dueDate}T00:00:00.000Z`),
                billingType: payment.billingType,
                customerId: existing.customerId,
                invoiceUrl: payment.invoiceUrl ?? null,
                standaloneInstallmentPlanId: existing.id,
              },
              create: {
                contaId,
                externalReference: chargeExtRef,
                status: mapStatus(payment.status),
                statusUpdatedAt: new Date(),
                asaasPaymentId: payment.id,
                description: payment.description ?? null,
                value: payment.value,
                dueDate: new Date(`${payment.dueDate}T00:00:00.000Z`),
                billingType: payment.billingType,
                customerId: existing.customerId,
                invoiceUrl: payment.invoiceUrl ?? null,
                standaloneInstallmentPlanId: existing.id,
              },
            });
          }
          console.log(`   ✅ Charges sincronizadas para plan ${existing.id}`);
        }

        totalCreated++;
        continue;
      }

      // Buscar payments para saber o customer
      const paymentsRes = await fetchJson<{ data: AsaasPayment[] }>(
        `${ASAAS_BASE_URL}/installments/${inst.id}/payments?limit=100&offset=0`,
        apiKey
      );
      const payments = paymentsRes.data;
      if (!payments.length) {
        console.log(`   ⚠️ ${inst.id} → sem payments, pulando`);
        totalSkipped++;
        continue;
      }

      const asaasCustomerId = payments[0].customer;

      // Buscar Customer local pelo asaasCustomerId
      const customer = await prisma.customer.findFirst({
        where: { contaId, asaasCustomerId },
        select: { id: true },
      });

      if (!customer) {
        console.log(
          `   🔸 ÓRFÃO: ${inst.id} → customer ${asaasCustomerId} não existe localmente`
        );
        totalOrphans++;
        continue;
      }

      const firstPayment = payments.sort((a, b) =>
        a.dueDate.localeCompare(b.dueDate)
      )[0];
      const firstDueDate = new Date(`${firstPayment.dueDate}T00:00:00.000Z`);
      const totalValue = payments.reduce((sum, p) => sum + p.value, 0);
      const externalRef = `alusa:installment:reconciled:${inst.id}`;
      const idempotencyKey = `reconciled:${inst.id}`;

      console.log(
        `   🆕 ${inst.id} → criando plan (${payments.length} parcelas, R$${totalValue})`
      );

      if (!isDryRun) {
        const plan = await prisma.standaloneInstallmentPlan.create({
          data: {
            contaId,
            customerId: customer.id,
            externalReference: externalRef,
            idempotencyKey,
            status: 'ACTIVE',
            asaasInstallmentId: inst.id,
            installmentCount: payments.length,
            billingType: inst.billingType,
            value: totalValue,
            firstDueDate,
          },
        });

        for (const payment of payments) {
          const chargeExtRef = `${externalRef}:payment:${payment.id}`;
          await prisma.charge.upsert({
            where: { asaasPaymentId: payment.id },
            update: {
              externalReference: chargeExtRef,
              status: mapStatus(payment.status),
              statusUpdatedAt: new Date(),
              payerName: null,
              description: payment.description ?? null,
              value: payment.value,
              dueDate: new Date(`${payment.dueDate}T00:00:00.000Z`),
              billingType: payment.billingType,
              customerId: customer.id,
              invoiceUrl: payment.invoiceUrl ?? null,
              standaloneInstallmentPlanId: plan.id,
            },
            create: {
              contaId,
              externalReference: chargeExtRef,
              status: mapStatus(payment.status),
              statusUpdatedAt: new Date(),
              asaasPaymentId: payment.id,
              payerName: null,
              description: payment.description ?? null,
              value: payment.value,
              dueDate: new Date(`${payment.dueDate}T00:00:00.000Z`),
              billingType: payment.billingType,
              customerId: customer.id,
              invoiceUrl: payment.invoiceUrl ?? null,
              standaloneInstallmentPlanId: plan.id,
            },
          });
        }

        console.log(`   ✅ Plan ${plan.id} criado com ${payments.length} charges`);
      }

      totalCreated++;
    }
  }

  console.log('\n═══════════════════════════════════════');
  console.log(`📊 Resumo:`);
  console.log(`   Criados: ${totalCreated}`);
  console.log(`   Já existentes: ${totalSkipped}`);
  console.log(`   Órfãos (sem customer local): ${totalOrphans}`);
  console.log('═══════════════════════════════════════');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('💥 Erro:', e);
  prisma.$disconnect();
  process.exit(1);
});
