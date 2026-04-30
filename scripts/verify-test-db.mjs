#!/usr/bin/env node
/**
 * 🔍 Script de Verificação de Banco de Dados
 * 
 * Valida que o banco de teste está isolado e funcionando corretamente.
 * 
 * Uso:
 *   dotenv -e .env.test -- node scripts/verify-test-db.mjs
 *   
 * Ou no package.json:
 *   pnpm db:verify:test
 */

/* eslint-disable no-console, no-process-exit, no-undef */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(color, icon, message) {
  console.log(`${color}${icon} ${message}${colors.reset}`);
}

async function main() {
  console.log('\n' + '='.repeat(60));
  log(colors.cyan, '🔍', 'Verificação de Banco de Dados de Teste');
  console.log('='.repeat(60) + '\n');

  try {
    // 1. Verifica DATABASE_URL
    log(colors.blue, '📋', 'Etapa 1: Validando DATABASE_URL');
    const dbUrl = process.env.DATABASE_URL;
    
    if (!dbUrl) {
      log(colors.red, '❌', 'DATABASE_URL não definida no .env.test');
      process.exit(1);
    }

    if (!dbUrl.includes('alusa_test')) {
      log(colors.red, '❌', 'DATABASE_URL não aponta para alusa_test');
      log(colors.yellow, '⚠️', `Atual: ${dbUrl}`);
      process.exit(1);
    }

    log(colors.green, '✅', 'DATABASE_URL configurada corretamente');
    log(colors.cyan, '   ', `   ${dbUrl.replace(/:[^:]*@/, ':***@')}`);

    // 2. Testa conexão
    log(colors.blue, '\n📋', 'Etapa 2: Testando conexão com banco');
    await prisma.$connect();
    log(colors.green, '✅', 'Conexão estabelecida com sucesso');

    // 3. Verifica migrações
    log(colors.blue, '\n📋', 'Etapa 3: Verificando migrações');
    const migrations = await prisma.$queryRaw`
      SELECT migration_name, finished_at
      FROM _prisma_migrations
      ORDER BY finished_at DESC
      LIMIT 5
    `;
    
    if (migrations.length === 0) {
      log(colors.yellow, '⚠️', 'Nenhuma migração encontrada');
      log(colors.cyan, '💡', 'Execute: pnpm db:migrate:test');
    } else {
      log(colors.green, '✅', `${migrations.length} migrações aplicadas`);
      migrations.forEach(m => {
        log(colors.cyan, '   ', `   - ${m.migration_name}`);
      });
    }

    // 4. Conta registros nas tabelas principais
    log(colors.blue, '\n📋', 'Etapa 4: Contando registros (tabelas principais)');
    
    const tables = [
      { name: 'Usuario', model: prisma.usuario },
      { name: 'Conta', model: prisma.conta },
      { name: 'Aluno', model: prisma.aluno },
      { name: 'Matricula', model: prisma.matricula },
      { name: 'Turma', model: prisma.turma },
      { name: 'Sala', model: prisma.sala },
      { name: 'Modalidade', model: prisma.modalidade },
    ];

    let totalRecords = 0;
    for (const table of tables) {
      const count = await table.model.count();
      totalRecords += count;
      
      if (count > 0) {
        log(colors.cyan, '📊', `${table.name}: ${count} registro(s)`);
      } else {
        log(colors.cyan, '📊', `${table.name}: 0 registros (vazio)`);
      }
    }

    // 5. Comparação com banco de desenvolvimento
    log(colors.blue, '\n📋', 'Etapa 5: Comparando com banco de desenvolvimento');
    
    try {
      const devPrisma = new PrismaClient({
        datasources: {
          db: {
            url: process.env.DATABASE_URL?.replace('alusa_test', 'alusa')
          }
        }
      });

      await devPrisma.$connect();
      const devCount = await devPrisma.usuario.count();
      await devPrisma.$disconnect();

      log(colors.green, '✅', 'Bancos estão isolados:');
      log(colors.cyan, '   ', `   - Desenvolvimento (alusa): ${devCount} usuários`);
      log(colors.cyan, '   ', `   - Teste (alusa_test): ${totalRecords} registros totais`);

      if (totalRecords === devCount) {
        log(colors.yellow, '⚠️', 'ATENÇÃO: Contagens similares, verifique isolamento!');
      }

    } catch {
      log(colors.yellow, '⚠️', 'Não foi possível conectar ao banco de desenvolvimento');
      log(colors.cyan, '💡', 'Isso é normal se ele não existir ou não tiver dados');
    }

    // 6. Resumo final
    log(colors.blue, '\n' + '='.repeat(60));
    log(colors.green, '✅', 'VERIFICAÇÃO CONCLUÍDA COM SUCESSO');
    console.log('='.repeat(60));
    
    log(colors.cyan, '\n💡', 'Próximos passos:');
    log(colors.cyan, '   ', '   1. Execute: pnpm db:migrate:test (se necessário)');
    log(colors.cyan, '   ', '   2. Execute: pnpm db:seed:test (para dados de exemplo)');
    log(colors.cyan, '   ', '   3. Execute: pnpm test:unit (para rodar os testes)');
    log(colors.cyan, '   ', '');
    log(colors.cyan, '📚', 'Documentação: docs/TESTES.md\n');

  } catch (error) {
    log(colors.red, '\n❌', 'ERRO na verificação:');
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
