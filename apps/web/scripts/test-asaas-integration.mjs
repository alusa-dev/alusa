/**
 * Script de teste: Validar integração Matrícula → Asaas
 *
 * Este script testa o fluxo completo de criação de matrícula
 * e sincronização com o Asaas (em modo dry-run ou real).
 *
 * Uso:
 *   node scripts/test-asaas-integration.mjs [--dry-run] [--verbose]
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const isDryRun = process.argv.includes('--dry-run');
const isVerbose = process.argv.includes('--verbose');

function log(message, data) {
  if (isVerbose) {
    console.log(`[Test Asaas] ${message}`, data || '');
  }
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
    taxaMatricula: 80,
    taxaIsenta: false,
    vencimentoDia: 5,
    formaPagamento: 'BOLETO',
    criarCobranca: true,
    createdById: 'test-script',
  };

  try {
    const response = await fetch('http://localhost:3000/api/matriculas', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('❌ Erro ao criar matrícula:', error);
      process.exit(1);
    }

    const result = await response.json();
    console.log('✅ Matrícula criada com sucesso!');
    console.log(`   ID: ${result.matricula.id}`);
    console.log(`   Asaas Subscription ID: ${result.matricula.asaasId || 'N/A'}`);
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
        logs: {
          where: { action: 'ASAAS_INTEGRADO' },
          take: 1,
        },
      },
    });

    if (!matricula) {
      console.error('❌ Matrícula não encontrada');
      return;
    }

    if (matricula.asaasSubscriptionId) {
      console.log('✅ Matrícula sincronizada com Asaas');
      console.log(`   Subscription ID: ${matricula.asaasSubscriptionId}`);
    } else {
      console.warn('⚠️  Matrícula sem subscription no Asaas');
      console.warn('   Verifique os logs do servidor para detalhes do erro');
    }

    const cobrancaComAsaas = matricula.cobrancas.find((c) => c.asaasPaymentId);
    if (cobrancaComAsaas) {
      console.log(`✅ Cobrança vinculada ao Asaas: ${cobrancaComAsaas.asaasPaymentId}`);
    } else {
      console.log('⚠️  Nenhuma cobrança vinculada ao Asaas ainda');
      console.log('   O paymentId será vinculado quando o webhook chegar');
    }

    if (matricula.logs.length > 0) {
      console.log('✅ Log de integração registrado');
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
    console.log(`   Cobranças com Asaas: ${cobrancasComAsaas}`);
    console.log(`   Webhooks processados: ${webhooksProcessados}`);
    console.log(`   Webhooks com erro: ${webhooksErro}`);
    console.log('');

    if (matriculasSemAsaas > 0) {
      console.warn(
        `⚠️  ${matriculasSemAsaas} matrícula(s) ativa(s) sem sincronização com Asaas`,
      );
      console.warn('   Execute o script de reprocessamento se necessário\n');
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
