/**
 * Reconciliação: MatriculaTurma para matrículas de combo sem turmas alocadas.
 *
 * Cenário: matrículas criadas com comboId mas sem MatriculaTurma correspondentes
 * (bug anterior à correção em matricula.service.ts).
 * O script encontra esses gaps e cria os registros idempotentemente.
 *
 * Uso:
 *   npx tsx scripts/reconcile-combo-matricula-turmas.ts
 *   npx tsx scripts/reconcile-combo-matricula-turmas.ts --dry-run
 *   npx tsx scripts/reconcile-combo-matricula-turmas.ts --contaId=xxx
 *   npx tsx scripts/reconcile-combo-matricula-turmas.ts --alunoNome=Bryan
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes('--dry-run');
const CONTA_ID_ARG = process.argv.find((a) => a.startsWith('--contaId='))?.split('=')[1];
const ALUNO_NOME_ARG = process.argv.find((a) => a.startsWith('--alunoNome='))?.split('=')[1];

async function main() {
  console.log(`\n🔍 Reconciliação MatriculaTurma para combos${DRY_RUN ? ' [DRY-RUN]' : ''}\n`);

  const matriculas = await prisma.matricula.findMany({
    where: {
      ...(CONTA_ID_ARG ? { aluno: { contaId: CONTA_ID_ARG } } : {}),
      ...(ALUNO_NOME_ARG ? { aluno: { nome: { contains: ALUNO_NOME_ARG, mode: 'insensitive' } } } : {}),
      comboId: { not: null },
    },
    select: {
      id: true,
      comboId: true,
      aluno: { select: { id: true, nome: true, contaId: true } },
      combo: { select: { id: true, nome: true, turmas: { select: { turmaId: true } } } },
      turmas: { select: { turmaId: true } },
    },
  });

  console.log(`📋 Matrículas com combo encontradas: ${matriculas.length}`);

  let totalCreated = 0;
  let totalSkipped = 0;

  for (const matricula of matriculas) {
    const comboTurmaIds = matricula.combo?.turmas.map((ct) => ct.turmaId) ?? [];
    const existingTurmaIds = new Set(matricula.turmas.map((mt) => mt.turmaId));

    const missing = comboTurmaIds.filter((id) => !existingTurmaIds.has(id));

    if (missing.length === 0) {
      totalSkipped++;
      continue;
    }

    console.log(
      `\n  Aluno: ${matricula.aluno.nome} (conta: ${matricula.aluno.contaId})` +
      `\n  Matrícula: ${matricula.id}` +
      `\n  Combo: ${matricula.combo?.nome ?? matricula.comboId}` +
      `\n  Turmas esperadas: ${comboTurmaIds.length} | Existentes: ${existingTurmaIds.size} | A criar: ${missing.length}` +
      `\n  TurmaIds a criar: ${missing.join(', ')}`,
    );

    if (!DRY_RUN) {
      await prisma.matriculaTurma.createMany({
        data: missing.map((turmaId) => ({ matriculaId: matricula.id, turmaId })),
        skipDuplicates: true,
      });
      console.log(`  ✅ ${missing.length} registro(s) criado(s)`);
    } else {
      console.log(`  ⏭️  [DRY-RUN] ${missing.length} registro(s) seriam criados`);
    }

    totalCreated += missing.length;
  }

  console.log(
    `\n✅ Concluído.` +
    `\n   Matrículas já corretas (ignoradas): ${totalSkipped}` +
    `\n   MatriculaTurma ${DRY_RUN ? 'a criar' : 'criados'}: ${totalCreated}\n`,
  );
}

main()
  .catch((err) => {
    console.error('❌ Erro:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
