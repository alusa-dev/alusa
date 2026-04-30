/**
 * Reconciliação: 1º ciclo de matrículas com subscription sem cobrança MENSALIDADE local.
 *
 * Cenário: rematricularAluno cria subscription no Asaas mas, se o GET de payments
 * falhar (try/catch não-bloqueante), a cobrança local do 1º ciclo não é persistida.
 * Este script encontra esses gaps e cria o registro idempotentemente.
 *
 * Uso:
 *   npx tsx scripts/reconcile-rematricula-first-cycle.ts
 *   npx tsx scripts/reconcile-rematricula-first-cycle.ts --dry-run
 *   npx tsx scripts/reconcile-rematricula-first-cycle.ts --contaId=xxx
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes('--dry-run');
const CONTA_ID_ARG = process.argv.find((a) => a.startsWith('--contaId='))?.split('=')[1];
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';

if (!ENCRYPTION_KEY) {
  console.error('❌ ENCRYPTION_KEY não definida. Defina via env ou .env.local');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Crypto
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Asaas API helper
// ---------------------------------------------------------------------------

const ASAAS_BASE = process.env.ASAAS_BASE_URL || 'https://api-sandbox.asaas.com/v3';

interface AsaasPaymentItem {
  id: string;
  value: number;
  dueDate: string;
  status: string;
  description?: string;
}

async function fetchSubscriptionPayments(
  apiKey: string,
  subscriptionId: string,
): Promise<AsaasPaymentItem[]> {
  const url = `${ASAAS_BASE}/payments?subscription=${encodeURIComponent(subscriptionId)}&limit=5`;
  const res = await fetch(url, {
    headers: { access_token: apiKey, 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Asaas GET payments?subscription=${subscriptionId}: HTTP ${res.status}`);
  }

  const body = await res.json();
  return (body.data ?? []) as AsaasPaymentItem[];
}

// ---------------------------------------------------------------------------
// Cache de API keys por contaId
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`🔍 Buscando matrículas com subscription sem cobrança MENSALIDADE...`);
  if (DRY_RUN) console.log('   (modo --dry-run: nenhuma escrita será feita)\n');

  const whereClause: Record<string, unknown> = {
    asaasSubscriptionId: { not: null },
    status: 'ATIVA',
    cobrancas: { none: { tipo: 'MENSALIDADE' } },
  };

  if (CONTA_ID_ARG) {
    whereClause.aluno = { contaId: CONTA_ID_ARG };
  }

  const matriculas = await prisma.matricula.findMany({
    where: whereClause,
    select: {
      id: true,
      asaasSubscriptionId: true,
      formaPagamentoTaxa: true,
      aluno: { select: { contaId: true, nome: true } },
      plano: { select: { nome: true } },
      combo: { select: { nome: true } },
    },
  });

  console.log(`📊 Encontradas ${matriculas.length} matrículas pendentes de reconciliação\n`);

  if (matriculas.length === 0) {
    console.log('✅ Nenhuma reconciliação necessária!');
    return;
  }

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const mat of matriculas) {
    const contaId = mat.aluno.contaId;
    const subId = mat.asaasSubscriptionId!;
    const label = `Matrícula ${mat.id} (${mat.aluno.nome})`;

    try {
      const apiKey = await getApiKey(contaId);
      if (!apiKey) {
        console.log(`⚠️  ${label}: sem API key para conta ${contaId} — pulando`);
        skipped++;
        continue;
      }

      const payments = await fetchSubscriptionPayments(apiKey, subId);
      if (payments.length === 0) {
        console.log(`⚠️  ${label}: subscription ${subId} sem payments no Asaas — pulando`);
        skipped++;
        continue;
      }

      const first = payments.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

      // Idempotência: verificar se já existe cobrança com este asaasPaymentId
      const existing = await prisma.cobranca.findFirst({
        where: { asaasPaymentId: first.id },
        select: { id: true },
      });

      if (existing) {
        console.log(`⏭️  ${label}: cobrança já existe para payment ${first.id} — pulando`);
        skipped++;
        continue;
      }

      const parsedDue = new Date(first.dueDate);
      const planoNome = mat.combo?.nome ?? mat.plano?.nome;
      const descricao = planoNome ? `Mensalidade - ${planoNome}` : 'Mensalidade';

      if (DRY_RUN) {
        console.log(`🟡 [DRY-RUN] Criaria cobrança MENSALIDADE para ${label}: payment=${first.id}, valor=${first.value}, vencimento=${first.dueDate}`);
        created++;
        continue;
      }

      await prisma.cobranca.create({
        data: {
          matriculaId: mat.id,
          tipo: 'MENSALIDADE',
          descricao,
          competenciaInicio: parsedDue,
          competenciaFim: parsedDue,
          valor: first.value,
          vencimento: parsedDue,
          formaPagamento: mat.formaPagamentoTaxa ?? 'BOLETO',
          status: 'A_VENCER',
          asaasPaymentId: first.id,
          asaasStatus: first.status,
        },
      });

      console.log(`✅ ${label}: cobrança MENSALIDADE criada (payment=${first.id})`);
      created++;
    } catch (err) {
      console.error(`❌ ${label}: erro — ${err instanceof Error ? err.message : String(err)}`);
      errors++;
    }
  }

  console.log('\n📈 Resumo:');
  console.log(`   ✅ Criadas:  ${created}`);
  console.log(`   ⏭️  Puladas: ${skipped}`);
  console.log(`   ❌ Erros:    ${errors}`);
}

main()
  .catch((e) => {
    console.error('Erro fatal:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
