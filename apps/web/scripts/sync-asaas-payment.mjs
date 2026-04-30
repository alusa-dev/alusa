#!/usr/bin/env node
/**
 * Script para sincronizar manualmente um pagamento do Asaas
 * 
 * Uso:
 *   node scripts/sync-asaas-payment.mjs <asaasPaymentId>
 * 
 * Exemplo:
 *   node scripts/sync-asaas-payment.mjs pay_c7xkz90ro21Bqy1
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const asaasPaymentId = process.argv[2];

if (!asaasPaymentId) {
  console.error('❌ Erro: Forneça o ID do pagamento do Asaas');
  console.log('\nUso: node scripts/sync-asaas-payment.mjs <asaasPaymentId>');
  console.log('Exemplo: node scripts/sync-asaas-payment.mjs pay_c7xkz90ro21Bqy1\n');
  process.exit(1);
}

async function syncPayment() {
  console.log(`\n🔍 Buscando cobrança com asaasPaymentId: ${asaasPaymentId}...\n`);

  try {
    // 1. Buscar cobrança
    const cobranca = await prisma.cobranca.findFirst({
      where: { asaasPaymentId },
      include: {
        matricula: {
          include: {
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

    if (!cobranca) {
      console.error(`❌ Cobrança não encontrada para payment ID: ${asaasPaymentId}`);
      console.log('\n💡 Dica: Verifique se o ID está correto no painel Asaas\n');
      return;
    }

    console.log('✅ Cobrança encontrada!');
    console.log(`   ID: ${cobranca.id}`);
    console.log(`   Aluno: ${cobranca.matricula.aluno.nome}`);
    console.log(`   Tipo: ${cobranca.tipo}`);
    console.log(`   Valor: R$ ${Number(cobranca.valor).toFixed(2)}`);
    console.log(`   Status Atual: ${cobranca.status}`);
    console.log(`   Matrícula Status: ${cobranca.matricula.status}\n`);

    if (cobranca.status === 'PAGO') {
      console.log('ℹ️  Esta cobrança já está marcada como PAGA');
      
      // Verificar se tem pagamento registrado
      const pagamento = await prisma.pagamento.findFirst({
        where: { asaasPaymentId },
      });

      if (pagamento) {
        console.log('✅ Registro de pagamento já existe');
        console.log(`   Data: ${pagamento.dataPagamento?.toLocaleDateString('pt-BR')}`);
        console.log(`   Valor Pago: R$ ${Number(pagamento.valorPago).toFixed(2)}`);
        console.log(`   Forma: ${pagamento.formaPagamento}\n`);
      } else {
        console.log('⚠️  Registro de pagamento NÃO existe - criando...\n');
        
        const novoPagamento = await prisma.pagamento.create({
          data: {
            cobrancaId: cobranca.id,
            dataPagamento: cobranca.dataPagamento || new Date(),
            formaPagamento: cobranca.formaPagamento,
            valorPago: cobranca.valor,
            status: 'CONFIRMADO',
            asaasPaymentId,
          },
        });

        console.log('✅ Registro de pagamento criado com sucesso!');
        console.log(`   ID: ${novoPagamento.id}\n`);
      }

      return;
    }

    // 2. Perguntar confirmação
    console.log('❓ Deseja atualizar esta cobrança para PAGA? (pressione Ctrl+C para cancelar)\n');
    console.log('   Aguardando 5 segundos...');
    
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('\n📝 Atualizando cobrança...\n');

    // 3. Atualizar cobrança
    const dataAtual = new Date();
    const cobrancaAtualizada = await prisma.cobranca.update({
      where: { id: cobranca.id },
      data: {
        status: 'PAGO',
        dataPagamento: dataAtual,
      },
    });

    console.log('✅ Cobrança atualizada para PAGO!');
    console.log(`   Status: ${cobrancaAtualizada.status}`);
    console.log(`   Data Pagamento: ${cobrancaAtualizada.dataPagamento?.toLocaleString('pt-BR')}\n`);

    // 4. Criar registro de pagamento
    console.log('💳 Criando registro de pagamento...\n');
    
    const pagamento = await prisma.pagamento.create({
      data: {
        cobrancaId: cobranca.id,
        dataPagamento: dataAtual,
        formaPagamento: cobranca.formaPagamento,
        valorPago: cobranca.valor,
        status: 'CONFIRMADO',
        asaasPaymentId,
      },
    });

    console.log('✅ Pagamento registrado com sucesso!');
    console.log(`   ID: ${pagamento.id}`);
    console.log(`   Valor: R$ ${Number(pagamento.valorPago).toFixed(2)}`);
    console.log(`   Forma: ${pagamento.formaPagamento}\n`);

    // 5. Se for taxa de matrícula, ativar matrícula
    if (cobranca.tipo === 'TAXA_MATRICULA') {
      console.log('🎓 Taxa de matrícula detectada - ativando matrícula...\n');
      
      const matriculaAtualizada = await prisma.matricula.update({
        where: { id: cobranca.matriculaId },
        data: {
          status: 'ATIVA',
          taxaStatus: 'PAGO',
        },
      });

      console.log('✅ Matrícula ativada!');
      console.log(`   Status: ${matriculaAtualizada.status}`);
      console.log(`   Taxa Status: ${matriculaAtualizada.taxaStatus}\n`);
    }

    // 6. Registrar log
    await prisma.logFinanceiro.create({
      data: {
        contaId: cobranca.matricula.aluno.contaId,
        usuarioId: 'system', // Script manual
        cobrancaId: cobranca.id,
        acao: 'SINCRONIZACAO_MANUAL_ASAAS',
        detalhes: {
          asaasPaymentId,
          valorPago: Number(cobranca.valor),
          motivoSincronizacao: 'Webhook não recebido - sincronização manual via script',
          scriptExecutadoEm: new Date().toISOString(),
        },
      },
    });

    console.log('✅ Log de auditoria registrado\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ SINCRONIZAÇÃO CONCLUÍDA COM SUCESSO!');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('📋 Resumo:');
    console.log(`   • Cobrança ${cobranca.id} atualizada para PAGO`);
    console.log(`   • Pagamento ${pagamento.id} registrado`);
    if (cobranca.tipo === 'TAXA_MATRICULA') {
      console.log(`   • Matrícula ${cobranca.matriculaId} ativada`);
    }
    console.log('\n');

  } catch (error) {
    console.error('\n❌ Erro ao sincronizar pagamento:', error);
    console.error('\nDetalhes:', error.message);
    if (error.stack) {
      console.error('\nStack trace:', error.stack);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

syncPayment();


