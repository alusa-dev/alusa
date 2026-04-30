/**
 * Script de pré-migration: Popular contaId em Responsavel existentes
 * 
 * Este script deve ser executado ANTES da migration prisma para:
 * 1. Adicionar coluna contaId como nullable
 * 2. Popular valores baseados nos vínculos com alunos
 * 3. Então a migration pode aplicar as constraints
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Iniciando migração de dados multi-tenant...\n');

  // 1. Verificar se coluna contaId já existe em Responsavel
  const tableInfo = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'Responsavel' AND column_name = 'contaId'
  `;

  if (tableInfo.length === 0) {
    console.log('📝 Adicionando coluna contaId à tabela Responsavel...');
    await prisma.$executeRaw`ALTER TABLE "Responsavel" ADD COLUMN IF NOT EXISTS "contaId" TEXT`;
  }

  // 2. Buscar responsáveis sem contaId
  const responsaveisSemConta = await prisma.$queryRaw<Array<{ id: string; nome: string }>>`
    SELECT id, nome FROM "Responsavel" WHERE "contaId" IS NULL
  `;

  console.log(`📋 Responsáveis sem contaId: ${responsaveisSemConta.length}`);

  for (const resp of responsaveisSemConta) {
    // Tentar encontrar contaId via AlunoResponsavel
    const vinculo = await prisma.$queryRaw<Array<{ contaId: string }>>`
      SELECT a."contaId"
      FROM "AlunoResponsavel" ar
      JOIN "Aluno" a ON ar."alunoId" = a.id
      WHERE ar."responsavelId" = ${resp.id}
      LIMIT 1
    `;

    if (vinculo.length > 0) {
      await prisma.$executeRaw`
        UPDATE "Responsavel" SET "contaId" = ${vinculo[0].contaId} WHERE id = ${resp.id}
      `;
      console.log(`  ✅ ${resp.nome} -> conta ${vinculo[0].contaId}`);
    } else {
      // Tentar via MatriculasFinanceiras
      const matriculaVinculo = await prisma.$queryRaw<Array<{ contaId: string }>>`
        SELECT a."contaId"
        FROM "Matricula" m
        JOIN "Aluno" a ON m."alunoId" = a.id
        WHERE m."responsavelFinanceiroId" = ${resp.id}
        LIMIT 1
      `;

      if (matriculaVinculo.length > 0) {
        await prisma.$executeRaw`
          UPDATE "Responsavel" SET "contaId" = ${matriculaVinculo[0].contaId} WHERE id = ${resp.id}
        `;
        console.log(`  ✅ ${resp.nome} -> conta ${matriculaVinculo[0].contaId} (via matrícula)`);
      } else {
        // Último recurso: usar primeira conta ativa
        const primeiraConta = await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "Conta" WHERE status = 'ATIVO' ORDER BY "createdAt" ASC LIMIT 1
        `;

        if (primeiraConta.length > 0) {
          await prisma.$executeRaw`
            UPDATE "Responsavel" SET "contaId" = ${primeiraConta[0].id} WHERE id = ${resp.id}
          `;
          console.log(`  ⚠️ ${resp.nome} -> conta ${primeiraConta[0].id} (fallback)`);
        } else {
          console.log(`  ❌ ${resp.nome} -> SEM CONTA DISPONÍVEL`);
        }
      }
    }
  }

  // 3. Verificar resultado
  const semConta = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count FROM "Responsavel" WHERE "contaId" IS NULL
  `;

  if (Number(semConta[0].count) > 0) {
    console.error(`\n❌ ERRO: Ainda há ${semConta[0].count} responsáveis sem contaId!`);
    process.exit(1);
  }

  console.log('\n✅ Todos os responsáveis têm contaId. Pronto para migration!');
}

main()
  .catch((e) => {
    console.error('❌ Erro:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
