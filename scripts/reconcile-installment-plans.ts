/**
 * Script de Reconciliação de Parcelamentos (InstallmentPlan)
 *
 * Este script:
 * 1. Busca todos os InstallmentPlans com asaasInstallmentId
 * 2. Para cada um, consulta o Asaas para obter os pagamentos do parcelamento
 * 3. Cria registros Cobranca para parcelas que não existem localmente
 *
 * Uso: npx tsx scripts/reconcile-installment-plans.ts [--dry-run]
 */

import { PrismaClient, StatusCobranca } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Chave de criptografia do ambiente local.
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error('Missing required encryption configuration.');
}

const isDryRun = process.argv.includes('--dry-run');

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
  netValue: number;
  dueDate: string;
  billingType: string;
  description?: string;
  externalReference?: string;
  status: string;
  installment?: string;
  installmentNumber?: number;
}

async function fetchInstallmentPayments(
  apiKey: string,
  installmentId: string
): Promise<AsaasPayment[]> {
  // Buscar pagamentos que pertencem a esse parcelamento
  const res = await fetch(
    `https://api-sandbox.asaas.com/v3/payments?installment=${installmentId}&limit=100`,
    {
      headers: {
        access_token: apiKey,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!res.ok) {
    throw new Error(`Erro ao buscar payments do installment ${installmentId}: ${res.status}`);
  }

  const data = await res.json();
  return data.data || [];
}

function mapAsaasStatusToCobranca(status: string): StatusCobranca {
  const statusMap: Record<string, StatusCobranca> = {
    PENDING: 'PENDENTE',
    RECEIVED: 'PAGO',
    CONFIRMED: 'PAGO',
    RECEIVED_IN_CASH: 'PAGO',
    OVERDUE: 'ATRASADO',
    REFUNDED: 'ESTORNADO',
    REFUND_REQUESTED: 'ESTORNADO',
    REFUND_IN_PROGRESS: 'ESTORNADO',
    CHARGEBACK_REQUESTED: 'ESTORNADO',
    CHARGEBACK_DISPUTE: 'ESTORNADO',
    AWAITING_CHARGEBACK_REVERSAL: 'PENDENTE',
    DUNNING_REQUESTED: 'ATRASADO',
    DUNNING_RECEIVED: 'PAGO',
    AWAITING_RISK_ANALYSIS: 'PENDENTE',
    DELETED: 'CANCELADO',
  };
  return statusMap[status] || 'PENDENTE';
}

async function main() {
  console.log('🔄 Iniciando reconciliação de parcelamentos...');
  console.log(isDryRun ? '📋 Modo: DRY-RUN (nenhuma alteração será feita)' : '⚡ Modo: EXECUÇÃO REAL');
  console.log('');

  // 1. Buscar todas as AsaasAccounts ativas com apiKeyEncrypted
  const asaasAccounts = await prisma.asaasAccount.findMany({
    where: {
      apiKeyEncrypted: { not: null },
      apiKeyStatus: 'CONNECTED',
    },
    include: {
      financeProfile: {
        include: {
          conta: {
            select: {
              id: true,
              nome: true,
            },
          },
        },
      },
    },
  });

  console.log(`📊 Encontradas ${asaasAccounts.length} subcontas ativas\n`);

  let totalPlansProcessed = 0;
  let totalCobrancasCreated = 0;
  let totalCobrancasUpdated = 0;

  for (const account of asaasAccounts) {
    const contaId = account.financeProfile.conta.id;
    const contaNome = account.financeProfile.conta.nome;
    let apiKey: string;

    try {
      apiKey = decrypt(account.apiKeyEncrypted!);
    } catch (e) {
      console.error(`❌ Erro ao descriptografar API key para conta ${contaNome}: ${e}`);
      continue;
    }

    console.log(`\n🏢 Processando conta: ${contaNome} (${contaId})`);

    // 2. Buscar InstallmentPlans desta conta com asaasInstallmentId
    const installmentPlans = await prisma.installmentPlan.findMany({
      where: {
        contaId,
        asaasInstallmentId: { not: null },
      },
      select: {
        id: true,
        externalReference: true,
        asaasInstallmentId: true,
        matriculaId: true,
        installmentCount: true,
        value: true,
        matricula: {
          select: {
            id: true,
            alunoId: true,
            planoId: true,
            comboId: true,
            plano: { select: { id: true, nome: true } },
            combo: { select: { id: true, nome: true } },
          },
        },
      },
    });

    console.log(`   📦 Encontrados ${installmentPlans.length} parcelamentos com asaasInstallmentId`);

    for (const plan of installmentPlans) {
      totalPlansProcessed++;
      const asaasInstallmentId = plan.asaasInstallmentId!;

      console.log(`\n   📋 Parcelamento: ${plan.id} (asaas: ${asaasInstallmentId})`);

      // 3. Buscar pagamentos deste parcelamento no Asaas
      let payments: AsaasPayment[];
      try {
        payments = await fetchInstallmentPayments(apiKey, asaasInstallmentId);
      } catch (e) {
        console.error(`      ❌ Erro ao buscar pagamentos: ${e}`);
        continue;
      }

      console.log(`      💳 ${payments.length} parcelas encontradas no Asaas`);

      // 4. Para cada pagamento, verificar se existe Cobranca local
      for (const payment of payments) {
        const existingCobranca = await prisma.cobranca.findFirst({
          where: {
            matriculaId: plan.matriculaId,
            asaasPaymentId: payment.id,
          },
          select: { id: true, status: true },
        });

        if (existingCobranca) {
          // Atualizar status se necessário
          const newStatus = mapAsaasStatusToCobranca(payment.status);
          if (existingCobranca.status !== newStatus) {
            if (!isDryRun) {
              await prisma.cobranca.update({
                where: { id: existingCobranca.id },
                data: {
                  status: newStatus,
                  asaasStatus: payment.status,
                },
              });
            }
            console.log(
              `      🔄 Cobrança ${existingCobranca.id}: ${existingCobranca.status} → ${newStatus}${isDryRun ? ' (dry-run)' : ''}`
            );
            totalCobrancasUpdated++;
          }
          continue;
        }

        // 5. Criar Cobranca se não existir
        const matricula = plan.matricula;
        const planoOuCombo = matricula.combo ?? matricula.plano;
        const installmentNumber = payment.installmentNumber ?? 1;
        const descricao = planoOuCombo?.nome
          ? `Parcela ${installmentNumber}/${plan.installmentCount} - ${planoOuCombo.nome}`
          : `Parcela ${installmentNumber}/${plan.installmentCount}`;

        const vencimento = new Date(payment.dueDate);
        const competenciaInicio = new Date(vencimento.getFullYear(), vencimento.getMonth(), 1);
        const competenciaFim = new Date(vencimento.getFullYear(), vencimento.getMonth() + 1, 0);

        if (!isDryRun) {
          const cobranca = await prisma.cobranca.create({
            data: {
              matriculaId: matricula.id,
              tipo: 'PARCELADA',
              valor: payment.value,
              vencimento,
              status: mapAsaasStatusToCobranca(payment.status),
              descricao,
              competenciaInicio,
              competenciaFim,
              asaasPaymentId: payment.id,
              asaasStatus: payment.status,
              asaasValue: payment.value,
              asaasNetValue: payment.netValue,
              formaPagamento: 'INDEFINIDO',
            },
          });

          // Criar Charge correspondente
          const chargeExternalRef = `${plan.externalReference}:payment:${payment.id}`;
          await prisma.charge.create({
            data: {
              id: cobranca.id,
              contaId,
              cobrancaId: cobranca.id,
              externalReference: chargeExternalRef,
              status: 'CREATED',
              statusUpdatedAt: new Date(),
              asaasPaymentId: payment.id,
            },
          });

          console.log(
            `      ✅ Criada Cobrança + Charge para parcela ${installmentNumber}: ${cobranca.id}`
          );
        } else {
          console.log(
            `      📝 [dry-run] Criaria Cobrança para parcela ${installmentNumber} (R$ ${payment.value}, ${payment.status})`
          );
        }

        totalCobrancasCreated++;
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMO DA RECONCILIAÇÃO');
  console.log('='.repeat(60));
  console.log(`   Parcelamentos processados: ${totalPlansProcessed}`);
  console.log(`   Cobranças criadas: ${totalCobrancasCreated}${isDryRun ? ' (dry-run)' : ''}`);
  console.log(`   Cobranças atualizadas: ${totalCobrancasUpdated}${isDryRun ? ' (dry-run)' : ''}`);
  console.log('='.repeat(60));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Erro fatal:', e);
  prisma.$disconnect();
  process.exit(1);
});
