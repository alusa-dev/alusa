/**
 * Script de teste: Validar integração Matrícula → Asaas
 *
 * Este script testa o fluxo completo de criação de matrícula
 * e sincronização com o Asaas (em modo dry-run ou real).
 *
 * Uso:
 *   node scripts/test-asaas-integration.mjs [--dry-run] [--verbose]
 */

import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const isDryRun = process.argv.includes('--dry-run');
const isVerbose = process.argv.includes('--verbose');

function log(message, data) {
  if (isVerbose) {
    console.log(`[Test Asaas] ${message}`, data || '');
  }
}

function isoDateFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

async function checkEnvironment() {
  console.log('\n📋 Verificando configuração...\n');

  const required = [
    'ASAAS_API_KEY',
    'ASAAS_ENVIRONMENT',
    'ASAAS_INTEGRATION_ENABLED',
    'ASAAS_WEBHOOK_SECRET',
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error('❌ Variáveis de ambiente faltando:');
    missing.forEach((key) => console.error(`   - ${key}`));
    console.error('\n⚠️  Configure em .env.local e tente novamente.');
    process.exit(1);
  }

  console.log('✅ Variáveis de ambiente configuradas');
  console.log(`   ASAAS_ENVIRONMENT: ${process.env.ASAAS_ENVIRONMENT}`);
  console.log(`   ASAAS_INTEGRATION_ENABLED: ${process.env.ASAAS_INTEGRATION_ENABLED}`);
  console.log('');
}

async function checkDatabase() {
  console.log('📊 Verificando banco de dados...\n');

  try {
    const conta = await prisma.conta.findFirst();
    if (!conta) {
      console.error('❌ Nenhuma conta encontrada no banco');
      process.exit(1);
    }
    log('Conta encontrada:', conta.id);

    const aluno = await prisma.aluno.findFirst({
      where: { contaId: conta.id },
      include: { responsaveis: true },
    });
    if (!aluno) {
      console.error('❌ Nenhum aluno encontrado');
      console.error('   Crie um aluno antes de testar.');
      process.exit(1);
    }
    log('Aluno encontrado:', { id: aluno.id, nome: aluno.nome });

    const plano = await prisma.plano.findFirst({
      where: { contaId: conta.id, status: 'ATIVO' },
    });
    if (!plano) {
      console.error('❌ Nenhum plano ativo encontrado');
      process.exit(1);
    }
    log('Plano encontrado:', { id: plano.id, nome: plano.nome });

    const turma = await prisma.turma.findFirst({
      where: { contaId: conta.id, status: 'ATIVA' },
    });
    if (!turma) {
      console.error('❌ Nenhuma turma ativa encontrada');
      process.exit(1);
    }
    log('Turma encontrada:', { id: turma.id, nome: turma.nome });

    console.log('✅ Banco de dados OK\n');
    return { conta, aluno, plano, turma };
  } catch (error) {
    console.error('❌ Erro ao verificar banco:', error.message);
    process.exit(1);
  }
}

async function checkAsaasConnection() {
  console.log('🔌 Testando conexão com Asaas...\n');

  try {
    const baseUrl =
      process.env.ASAAS_ENVIRONMENT === 'production'
        ? 'https://api.asaas.com/v3'
        : 'https://api-sandbox.asaas.com/v3';

    const response = await fetch(
      `${baseUrl}/customers?limit=1`,
      {
        headers: {
          access_token: process.env.ASAAS_API_KEY,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!response.ok) {
      const error = await response.json();
      console.error('❌ Erro na API do Asaas:', error);
      process.exit(1);
    }

    console.log('✅ Conexão com Asaas OK\n');
  } catch (error) {
    console.error('❌ Erro ao conectar com Asaas:', error.message);
    process.exit(1);
  }
}

async function testMatriculaCreation(data) {
  console.log('🧪 Testando criação de matrícula...\n');

  if (isDryRun) {
    console.log('   [DRY RUN] Pulando criação real de matrícula');
    console.log('   Para testar de verdade, remova --dry-run\n');
    return;
  }

  const payload = {
    contaId: data.conta.id,
    alunoId: data.aluno.id,
    planoId: data.plano.id,
    turmaId: data.turma.id,
    responsavelFinanceiroId: data.aluno.responsaveis[0]?.id || null,
    dataInicio: isoDateFromNow(0),
    dataFimContrato: isoDateFromNow(365),
    taxaMatricula: 80,
    taxaIsenta: false,
    gerarCobrancaTaxa: true,
    vencimentoDia: 5,
    formaPagamento: 'BOLETO',
    formaPagamentoTaxa: 'BOLETO',
    criarCobranca: true,
    uiRequestId: `script-asaas-${randomUUID()}`,
    billingStrategy: { kind: 'SEPARATE' },
    createdById: 'test-script',
  };

  try {
    const previewResponse = await fetch('http://localhost:3000/api/matriculas/billing-preview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contaId: payload.contaId,
        strategy: 'CREATE_SEPARATE',
        billingStrategy: payload.billingStrategy,
        responsavelFinanceiroId: payload.responsavelFinanceiroId,
        existingFamilyGroupId: null,
        dataInicio: payload.dataInicio,
        dataFimContrato: payload.dataFimContrato,
        formaPagamento: payload.formaPagamento,
        vencimentoDia: payload.vencimentoDia,
        descontoIds: [],
        items: [
          {
            alunoId: payload.alunoId,
            turmaId: payload.turmaId,
            planoId: payload.planoId,
            comboId: null,
            taxaMatricula: payload.taxaMatricula,
            valorMensalidadeOverride: null,
          },
        ],
      }),
    });

    if (!previewResponse.ok) {
      const error = await previewResponse.json().catch(() => ({}));
      console.error('Erro ao gerar preview financeiro:', error);
      console.error('Dica: confirme que o servidor local esta autenticado para a conta usada no teste.');
      process.exit(1);
    }

    const preview = await previewResponse.json();
    if (!preview.compatibility?.compatible) {
      console.error('Preview financeiro incompatível:', preview.compatibility?.blockers ?? []);
      process.exit(1);
    }

    const response = await fetch('http://localhost:3000/api/matriculas', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...payload,
        billingStrategy: preview.billingStrategy,
        previewHash: preview.previewHash,
        sourceVersion: preview.sourceVersion,
        previewExpiresAt: preview.expiresAt,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('❌ Erro ao criar matrícula:', error);
      process.exit(1);
    }

    const result = await response.json();
    console.log('✅ Matrícula criada com sucesso!');
    console.log(`   ID: ${result.matricula.id}`);
    console.log(`   Provisionamento financeiro: ${result.matricula.billingProvisionStatus || 'N/A'}`);
    console.log(`   Asaas Subscription ID: ${result.matricula.asaasId || 'N/A'} (pode ser preenchido pelo worker/webhook)`);
    console.log(`   Status: ${result.matricula.status}`);
    console.log('');

    return result.matricula.id;
  } catch (error) {
    console.error('❌ Erro ao criar matrícula:', error.message);
    process.exit(1);
  }
}

async function checkMatriculaAsaasSync(matriculaId) {
  console.log('🔍 Verificando sincronização com Asaas...\n');

  if (isDryRun) {
    console.log('   [DRY RUN] Pulando verificação\n');
    return;
  }

  try {
    const matricula = await prisma.matricula.findUnique({
      where: { id: matriculaId },
      include: {
        cobrancas: true,
        billingOutboxEvents: {
          orderBy: { createdAt: 'desc' },
          take: 3,
        },
        logs: {
          orderBy: { createdAt: 'desc' },
          take: 3,
        },
      },
    });

    if (!matricula) {
      console.error('❌ Matrícula não encontrada');
      return;
    }

    console.log(`   Provisionamento financeiro local: ${matricula.billingProvisionStatus}`);

    if (matricula.asaasSubscriptionId) {
      console.log('✅ Matrícula sincronizada com Asaas');
      console.log(`   Subscription ID: ${matricula.asaasSubscriptionId}`);
    } else if (matricula.billingProvisionStatus === 'PENDENTE') {
      console.log('⏳ Provisionamento financeiro pendente');
      console.log('   O worker de outbox ainda precisa preparar a assinatura/cobrança no Asaas');
    } else {
      console.warn('⚠️  Matrícula sem subscription no Asaas');
      console.warn('   Verifique o status de provisionamento, outbox e logs do servidor');
    }

    if (matricula.billingOutboxEvents.length > 0) {
      console.log('   Outbox de provisionamento:');
      matricula.billingOutboxEvents.forEach((event) => {
        console.log(`   - ${event.eventType}: ${event.status} (${event.attempts} tentativa(s))`);
      });
    }

    const cobrancaComAsaas = matricula.cobrancas.find((c) => c.asaasPaymentId);
    if (cobrancaComAsaas) {
      console.log(`✅ Cobrança vinculada ao Asaas: ${cobrancaComAsaas.asaasPaymentId}`);
    } else {
      console.log('⚠️  Nenhuma cobrança vinculada ao Asaas ainda');
      console.log('   O paymentId será vinculado quando o webhook chegar');
    }

    if (matricula.logs.length > 0) {
      console.log('✅ Logs operacionais registrados');
    }

    console.log('');
  } catch (error) {
    console.error('❌ Erro ao verificar sincronização:', error.message);
  }
}

async function checkWebhooks() {
  console.log('📥 Verificando webhooks recentes...\n');

  try {
    const webhooks = await prisma.webhookAsaas.findMany({
      orderBy: { recebidoEm: 'desc' },
      take: 5,
    });

    if (webhooks.length === 0) {
      console.log('⚠️  Nenhum webhook recebido ainda');
      console.log('   Configure o webhook no painel do Asaas\n');
      return;
    }

    console.log(`✅ ${webhooks.length} webhooks recentes:`);
    webhooks.forEach((wh) => {
      console.log(`   - ${wh.evento} (${wh.status}) em ${wh.recebidoEm.toISOString()}`);
    });
    console.log('');
  } catch (error) {
    console.error('❌ Erro ao buscar webhooks:', error.message);
  }
}

async function showSummary() {
  console.log('\n📈 Resumo da integração:\n');

  try {
    const matriculasComAsaas = await prisma.matricula.count({
      where: { asaasSubscriptionId: { not: null } },
    });
    const matriculasSemAsaas = await prisma.matricula.count({
      where: { asaasSubscriptionId: null, status: { not: 'CANCELADA' } },
    });
    const provisionamentoPendente = await prisma.matricula.count({
      where: {
        billingProvisionStatus: { in: ['PENDENTE', 'PROCESSANDO'] },
        status: { not: 'CANCELADA' },
      },
    });
    const provisionamentoComErro = await prisma.matricula.count({
      where: {
        billingProvisionStatus: { in: ['FALHO', 'RESULTADO_INCERTO'] },
        status: { not: 'CANCELADA' },
      },
    });
    const cobrancasComAsaas = await prisma.cobranca.count({
      where: { asaasPaymentId: { not: null } },
    });
    const webhooksProcessados = await prisma.webhookAsaas.count({
      where: { status: 'PROCESSADO' },
    });
    const webhooksErro = await prisma.webhookAsaas.count({
      where: { status: 'ERRO' },
    });

    console.log(`   Matrículas com Asaas: ${matriculasComAsaas}`);
    console.log(`   Matrículas sem Asaas: ${matriculasSemAsaas}`);
    console.log(`   Provisionamento pendente/processando: ${provisionamentoPendente}`);
    console.log(`   Provisionamento com erro/reconciliação: ${provisionamentoComErro}`);
    console.log(`   Cobranças com Asaas: ${cobrancasComAsaas}`);
    console.log(`   Webhooks processados: ${webhooksProcessados}`);
    console.log(`   Webhooks com erro: ${webhooksErro}`);
    console.log('');

    if (provisionamentoComErro > 0) {
      console.warn(
        `⚠️  ${provisionamentoComErro} matrícula(s) exigem intervenção/reconciliação financeira`,
      );
      console.warn('   Use a ação operacional de reconciliação ou reprocessamento seguro\n');
    }
  } catch (error) {
    console.error('❌ Erro ao gerar resumo:', error.message);
  }
}

async function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  TESTE DE INTEGRAÇÃO MATRÍCULA → ASAAS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (isDryRun) {
    console.log('\n⚠️  Modo DRY RUN ativo (nenhuma alteração será feita)');
  }

  await checkEnvironment();
  const data = await checkDatabase();
  await checkAsaasConnection();
  const matriculaId = await testMatriculaCreation(data);
  if (matriculaId) {
    await checkMatriculaAsaasSync(matriculaId);
  }
  await checkWebhooks();
  await showSummary();

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ✅ Teste concluído!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('\n❌ Erro fatal:', error);
  process.exit(1);
});
