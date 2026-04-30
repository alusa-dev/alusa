/**
 * Script de reconciliação: Cria Charge para Cobranças MENSALIDADE que estão faltando
 * 
 * Problema: Cobranças do tipo MENSALIDADE criadas via Subscription não têm
 * um Charge correspondente, causando inconsistência na listagem.
 * 
 * Solução: Criar Charge para cada Cobranca MENSALIDADE que não tem um.
 */

import { PrismaClient, ChargeStatus } from '@prisma/client';

const prisma = new PrismaClient();

// Mapeamento StatusCobranca → ChargeStatus
function mapCobrancaStatusToChargeStatus(cobrancaStatus: string): ChargeStatus {
  switch (cobrancaStatus) {
    case 'PAGO':
      return 'PAID';
    case 'ATRASADO':
      return 'OVERDUE';
    case 'CANCELADO':
    case 'CANCELAMENTO_PENDENTE':
      return 'CANCELED';
    case 'ESTORNADO':
    case 'ESTORNADO_PARCIAL':
      return 'REFUNDED';
    case 'A_VENCER':
    case 'PENDENTE':
    case 'PROCESSANDO':
    default:
      return 'OPEN';
  }
}

async function main() {
  console.log('🔍 Buscando cobranças MENSALIDADE sem Charge vinculado...\n');

  // Buscar todas as Cobranças MENSALIDADE que não têm Charge (relação 1:1)
  const cobrancasSemCharge = await prisma.cobranca.findMany({
    where: {
      tipo: 'MENSALIDADE',
      charge: null, // Relação 1:1
    },
    include: {
      matricula: {
        select: {
          id: true,
          aluno: {
            select: {
              id: true,
              nome: true,
              contaId: true,
            },
          },
        },
      },
    },
  });
  
  // Buscar subscriptions para cada matricula
  const matriculaIds = [...new Set(cobrancasSemCharge.map(c => c.matriculaId))];
  const subscriptions = await prisma.subscription.findMany({
    where: { matriculaId: { in: matriculaIds } },
    select: { id: true, matriculaId: true, externalReference: true },
  });
  const subscriptionByMatricula = new Map(subscriptions.map(s => [s.matriculaId, s]));

  console.log(`📊 Encontradas ${cobrancasSemCharge.length} cobranças MENSALIDADE sem Charge\n`);

  if (cobrancasSemCharge.length === 0) {
    console.log('✅ Nenhuma reconciliação necessária!');
    return;
  }

  let created = 0;
  let errors = 0;

  for (const cobranca of cobrancasSemCharge) {
    const contaId = cobranca.matricula.aluno.contaId;
    const subscription = subscriptionByMatricula.get(cobranca.matriculaId);
    const subscriptionRef = subscription?.externalReference;

    if (!contaId) {
      console.log(`⚠️  Cobrança ${cobranca.id} sem contaId - pulando`);
      errors++;
      continue;
    }

    // Gerar externalReference baseado na subscription
    const externalReference = subscriptionRef
      ? `${subscriptionRef}:payment:${cobranca.asaasPaymentId ?? cobranca.id}`
      : `mensalidade:${cobranca.id}`;

    try {
      await prisma.charge.create({
        data: {
          contaId,
          cobrancaId: cobranca.id,
          externalReference,
          asaasPaymentId: cobranca.asaasPaymentId,
          status: mapCobrancaStatusToChargeStatus(cobranca.status),
          statusUpdatedAt: cobranca.updatedAt ?? new Date(),
          // Campos opcionais para listagem
          payerName: cobranca.matricula.aluno.nome,
          description: `Mensalidade - ${cobranca.descricao ?? 'Matrícula'}`,
          value: cobranca.valor,
          dueDate: cobranca.vencimento,
          billingType: cobranca.formaPagamento ?? 'BOLETO',
        },
      });

      console.log(`✅ Charge criado para Cobrança ${cobranca.id} (${cobranca.matricula.aluno.nome})`);
      created++;
    } catch (error) {
      console.error(`❌ Erro ao criar Charge para ${cobranca.id}:`, error);
      errors++;
    }
  }

  console.log('\n📈 Resumo:');
  console.log(`   ✅ Charges criados: ${created}`);
  console.log(`   ❌ Erros: ${errors}`);
}

main()
  .catch((e) => {
    console.error('Erro fatal:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
