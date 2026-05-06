/**
 * Remove todas as matrículas (e vínculos financeiros locais) para testes com alunos sem matrícula.
 *
 * Também remove agregados de matrícula familiar / rematrícula familiar do escopo.
 * Não cancela assinaturas no Asaas — apenas limpa o banco local.
 *
 * Uso:
 *   pnpm exec dotenv -e .env.local -- tsx scripts/wipe-matriculas-for-testing.ts --dry-run
 *   WIPE_MATRICULAS_CONFIRM=YES pnpm exec dotenv -e .env.local -- tsx scripts/wipe-matriculas-for-testing.ts --execute
 *
 * Opcional: escopo por conta
 *   CONTA_ID=clxxx WIPE_MATRICULAS_CONFIRM=YES ... --execute
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function parseArgs() {
  const dryRun = process.argv.includes('--dry-run');
  const execute = process.argv.includes('--execute');
  const contaId = process.env.CONTA_ID?.trim() || undefined;
  const confirm = process.env.WIPE_MATRICULAS_CONFIRM === 'YES';
  return { dryRun, execute, contaId, confirm };
}

async function main() {
  const { dryRun, execute, contaId, confirm } = parseArgs();

  if (!dryRun && !execute) {
    console.error('Informe --dry-run ou --execute');
    process.exit(1);
  }
  if (execute && !confirm) {
    console.error('Para executar, defina WIPE_MATRICULAS_CONFIRM=YES');
    process.exit(1);
  }

  const matriculaWhere = contaId ? { aluno: { contaId } } : {};

  const matriculas = await prisma.matricula.findMany({
    where: matriculaWhere,
    select: { id: true },
  });
  const matriculaIds = matriculas.map((m) => m.id);

  const familiarWhere = contaId ? { contaId } : {};

  const remOpWhere = contaId
    ? { contaId }
    : matriculaIds.length > 0
      ? {
          OR: [{ matriculaOrigemId: { in: matriculaIds } }, { matriculaNovaId: { in: matriculaIds } }],
        }
      : {};

  const payerOpWhere = contaId ? { contaId } : matriculaIds.length > 0 ? { matriculaId: { in: matriculaIds } } : {};

  const nFamiliar = await prisma.matriculaFamiliar.count({ where: familiarWhere });
  const nRemFamiliar = await prisma.rematriculaFamiliar.count({ where: familiarWhere });
  const nRemOps = await prisma.rematriculaOperacao.count({ where: remOpWhere });
  const nPayerOps = await prisma.payerChangeOperacao.count({ where: payerOpWhere });

  console.log(
    JSON.stringify(
      {
        scope: contaId ? { contaId } : 'ALL_TENANTS',
        matriculas: matriculaIds.length,
        matriculaFamiliar: nFamiliar,
        rematriculaFamiliar: nRemFamiliar,
        rematriculaOperacao: nRemOps,
        payerChangeOperacao: nPayerOps,
        dryRun,
      },
      null,
      2,
    ),
  );

  if (dryRun || !execute) {
    await prisma.$disconnect();
    return;
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.rematriculaOperacao.deleteMany({ where: remOpWhere });
      await tx.payerChangeOperacao.deleteMany({ where: payerOpWhere });

      if (matriculaIds.length) {
        await tx.chargeReadModel.deleteMany({
          where: { matriculaId: { in: matriculaIds } },
        });
      } else {
        await tx.chargeReadModel.deleteMany({
          where: { matriculaId: { not: null } },
        });
      }

      const cobrancaIds =
        matriculaIds.length > 0
          ? (
              await tx.cobranca.findMany({
                where: { matriculaId: { in: matriculaIds } },
                select: { id: true },
              })
            ).map((c) => c.id)
          : (await tx.cobranca.findMany({ select: { id: true } })).map((c) => c.id);

      if (cobrancaIds.length) {
        const chargeIds = (
          await tx.charge.findMany({
            where: { cobrancaId: { in: cobrancaIds } },
            select: { id: true },
          })
        ).map((c) => c.id);

        if (chargeIds.length) {
          await tx.asaasIntegrationJob.deleteMany({
            where: { chargeId: { in: chargeIds } },
          });
          await tx.charge.deleteMany({ where: { id: { in: chargeIds } } });
        }

        await tx.asaasIntegrationJob.deleteMany({
          where: { cobrancaId: { in: cobrancaIds } },
        });
      }

      await tx.matriculaFamiliar.deleteMany({ where: familiarWhere });
      await tx.rematriculaFamiliar.deleteMany({ where: familiarWhere });

      if (matriculaIds.length) {
        await tx.matricula.updateMany({
          where: { rematriculadaDeId: { in: matriculaIds } },
          data: { rematriculadaDeId: null },
        });
        await tx.matricula.updateMany({
          where: { id: { in: matriculaIds } },
          data: { contratoAtualId: null, rematriculadaDeId: null },
        });
        await tx.matricula.deleteMany({ where: { id: { in: matriculaIds } } });
      } else {
        await tx.matricula.updateMany({ data: { rematriculadaDeId: null, contratoAtualId: null } });
        await tx.matricula.deleteMany();
      }
    },
    { timeout: 120_000 },
  );

  console.log('Concluído: matrículas e cobranças vinculadas removidas (escopo acima).');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
