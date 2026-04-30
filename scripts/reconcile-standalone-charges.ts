/**
 * Script de Reconciliação de Cobranças Standalone
 * 
 * Este script busca os pagamentos no Asaas e atualiza os registros de Charge locais
 * que têm campos null (payerName, value, dueDate, billingType, description).
 * 
 * Uso: npx tsx scripts/reconcile-standalone-charges.ts
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Chave de criptografia do ambiente local.
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error('Missing required encryption configuration.');
}

function decrypt(encoded: string): string {
  const raw = ENCRYPTION_KEY;
  const key = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');

  const parts = encoded.split(':');
  const [ivHex, , authTagHex, encryptedHex] = parts;

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
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
  deleted?: boolean;
}

interface AsaasCustomer {
  id: string;
  name: string;
}

async function fetchAsaasPayments(apiKey: string): Promise<AsaasPayment[]> {
  const res = await fetch('https://api-sandbox.asaas.com/v3/payments?limit=100', {
    headers: {
      'access_token': apiKey,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Erro ao buscar payments: ${res.status}`);
  }

  const data = await res.json();
  return data.data || [];
}

async function fetchAsaasPaymentById(apiKey: string, paymentId: string): Promise<AsaasPayment | null> {
  const res = await fetch(`https://api-sandbox.asaas.com/v3/payments/${paymentId}`, {
    headers: {
      'access_token': apiKey,
      'Content-Type': 'application/json',
    },
  });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    throw new Error(`Erro ao buscar payment ${paymentId}: ${res.status}`);
  }

  return res.json();
}

async function resolveExternalReferenceForUpdate(chargeId: string, externalReference: string | undefined, currentExternalReference: string) {
  if (!externalReference || externalReference === currentExternalReference) {
    return currentExternalReference;
  }

  const conflicting = await prisma.charge.findFirst({
    where: {
      externalReference,
      NOT: { id: chargeId },
    },
    select: { id: true },
  });

  return conflicting ? currentExternalReference : externalReference;
}

async function fetchAsaasCustomers(apiKey: string): Promise<Map<string, string>> {
  const res = await fetch('https://api-sandbox.asaas.com/v3/customers?limit=100', {
    headers: {
      'access_token': apiKey,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Erro ao buscar customers: ${res.status}`);
  }

  const data = await res.json();
  const map = new Map<string, string>();
  
  for (const c of (data.data || []) as AsaasCustomer[]) {
    map.set(c.id, c.name);
  }

  return map;
}

function mapAsaasStatus(status: string, deleted?: boolean): string {
  if (deleted || status === 'DELETED') {
    return 'CANCELED';
  }

  const statusMap: Record<string, string> = {
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
    AWAITING_CHARGEBACK_REVERSAL: 'REFUNDED',
    DUNNING_REQUESTED: 'OVERDUE',
    DUNNING_RECEIVED: 'PAID',
    AWAITING_RISK_ANALYSIS: 'OPEN',
  };
  return statusMap[status] || 'OPEN';
}

async function main() {
  console.log('🔄 Iniciando reconciliação de cobranças standalone...\n');

  const chargeIdArg = process.argv.find((arg) => arg.startsWith('--chargeId='));
  const targetChargeId = chargeIdArg?.split('=')[1]?.trim() || process.env.CHARGE_ID || null;
  const contaIdArg = process.argv.find((arg) => arg.startsWith('--contaId='));
  const targetContaId = contaIdArg?.split('=')[1]?.trim() || process.env.CONTA_ID || null;

  // 1. Buscar todas as Charges que precisam de reconciliação
  const chargesToReconcile = await prisma.charge.findMany({
    where: {
      ...(targetContaId ? { contaId: targetContaId } : {}),
      asaasPaymentId: { not: null },
      ...(targetChargeId
        ? { id: targetChargeId }
        : {
            OR: [
              { payerName: null },
              { payerName: 'NEEDS_REVIEW' },
              { value: null },
              { dueDate: null },
              { billingType: null },
              { description: '[NEEDS_REVIEW] Payment sem vínculo local' },
              { externalReference: { contains: ':needs-review:' } },
            ],
          }),
    },
    select: {
      id: true,
      contaId: true,
      asaasPaymentId: true,
      payerName: true,
      value: true,
      dueDate: true,
      billingType: true,
      description: true,
      status: true,
      externalReference: true,
    },
  });

  if (chargesToReconcile.length === 0) {
    console.log(targetChargeId
      ? `✅ Nenhuma cobrança encontrada para reconciliação com id ${targetChargeId}.`
      : '✅ Nenhuma cobrança precisa de reconciliação.');
    return;
  }

  console.log(`📋 ${chargesToReconcile.length} cobranças precisam de reconciliação\n`);

  // 2. Agrupar por contaId para buscar credenciais
  const chargesByContaId = new Map<string, typeof chargesToReconcile>();
  for (const charge of chargesToReconcile) {
    const existing = chargesByContaId.get(charge.contaId) || [];
    existing.push(charge);
    chargesByContaId.set(charge.contaId, existing);
  }

  // 3. Processar por conta
  for (const [contaId, charges] of chargesByContaId) {
    console.log(`\n📁 Processando conta ${contaId}...`);

    // Buscar credenciais da conta via FinanceProfile -> AsaasAccount
    const financeProfile = await prisma.financeProfile.findFirst({
      where: { contaId },
      select: {
        asaasAccount: {
          select: { apiKeyEncrypted: true, apiKeyStatus: true },
        },
      },
    });

    const asaasAccount = financeProfile?.asaasAccount;
    if (!asaasAccount?.apiKeyEncrypted || asaasAccount.apiKeyStatus !== 'CONNECTED') {
      console.log(`  ⚠️  Sem credenciais Asaas para conta ${contaId}, pulando...`);
      continue;
    }

    const apiKey = decrypt(asaasAccount.apiKeyEncrypted);

    // Buscar payments e customers do Asaas
    const [payments, customerNames] = await Promise.all([
      fetchAsaasPayments(apiKey),
      fetchAsaasCustomers(apiKey),
    ]);

    // Criar mapa de payments por ID
    const paymentMap = new Map<string, AsaasPayment>();
    for (const p of payments) {
      paymentMap.set(p.id, p);
    }

    // 4. Atualizar cada charge
    let updated = 0;
    for (const charge of charges) {
      if (!charge.asaasPaymentId) continue;

      let asaasPayment = paymentMap.get(charge.asaasPaymentId);
      if (!asaasPayment) {
        asaasPayment = await fetchAsaasPaymentById(apiKey, charge.asaasPaymentId);
      }

      if (!asaasPayment) {
        console.log(`  ⚠️  Payment ${charge.asaasPaymentId} não encontrado no Asaas`);
        continue;
      }

      const payerName = customerNames.get(asaasPayment.customer) || 'Cliente';
      const newStatus = mapAsaasStatus(asaasPayment.status, asaasPayment.deleted);
      const externalReference = await resolveExternalReferenceForUpdate(
        charge.id,
        asaasPayment.externalReference,
        charge.externalReference,
      );

      try {
        await prisma.charge.update({
          where: { id: charge.id },
          data: {
            payerName,
            value: asaasPayment.value,
            dueDate: new Date(`${asaasPayment.dueDate}T00:00:00`),
            billingType: asaasPayment.billingType,
            description: asaasPayment.description || (charge.description === '[NEEDS_REVIEW] Payment sem vínculo local' ? 'Cobrança' : charge.description) || 'Cobrança',
            status: newStatus,
            externalReference,
            statusUpdatedAt: new Date(),
          },
        });
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
          await prisma.charge.update({
            where: { id: charge.id },
            data: {
              payerName,
              value: asaasPayment.value,
              dueDate: new Date(`${asaasPayment.dueDate}T00:00:00`),
              billingType: asaasPayment.billingType,
              description: asaasPayment.description || (charge.description === '[NEEDS_REVIEW] Payment sem vínculo local' ? 'Cobrança' : charge.description) || 'Cobrança',
              status: newStatus,
              statusUpdatedAt: new Date(),
            },
          });
          console.log(`  ⚠️  Charge ${charge.id} mantida com externalReference local por conflito de unicidade`);
        } else {
          throw error;
        }
      }

      console.log(`  ✅ Charge ${charge.id} atualizada: ${payerName}, R$ ${asaasPayment.value}, ${asaasPayment.dueDate}`);
      updated++;
    }

    console.log(`  📊 ${updated}/${charges.length} cobranças atualizadas para conta ${contaId}`);
  }

  console.log('\n✅ Reconciliação concluída!');
}

main()
  .catch((e) => {
    console.error('❌ Erro na reconciliação:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
