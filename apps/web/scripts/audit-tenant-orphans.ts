#!/usr/bin/env tsx
/**
 * @file audit-tenant-orphans.ts
 * @description Script de auditoria para detectar registros órfãos ou com
 * contaId cruzado no banco de dados multitenant Alusa.
 *
 * Este script implementa a Fase 4 do plano de isolamento multitenant.
 * Executa verificações de integridade referencial e coerência de tenant
 * para identificar dados que possam ter sido criados incorretamente.
 *
 * Verificações realizadas:
 * 1. Registros com contaId nulo ou inválido (não existente na tabela Conta)
 * 2. Matrículas cujo aluno pertence a uma conta diferente
 * 3. Cobranças cujo aluno pertence a uma conta diferente  
 * 4. Usuários com contaId que não existe na tabela Conta
 * 5. Registros de modelos financeiros sem conta correspondente
 * 6. Sumário de integridade por tenant
 *
 * Execução:
 *   npx tsx apps/web/scripts/audit-tenant-orphans.ts
 *   npx tsx apps/web/scripts/audit-tenant-orphans.ts --fix  # Modo interativo (futuro)
 *   npx tsx apps/web/scripts/audit-tenant-orphans.ts --json # Output JSON para CI/CD
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  log: ['error'],
});

type AuditIssue = {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  description: string;
  count: number;
  sampleIds?: string[];
};

const issues: AuditIssue[] = [];
let totalChecks = 0;

function logIssue(issue: AuditIssue): void {
  issues.push(issue);
  const emoji = {
    CRITICAL: '🔴',
    HIGH: '🟠',
    MEDIUM: '🟡',
    LOW: '🔵',
  }[issue.severity];
  console.log(`  ${emoji} [${issue.severity}] ${issue.category}: ${issue.description}`);
  console.log(`     Registros afetados: ${issue.count}`);
  if (issue.sampleIds && issue.sampleIds.length > 0) {
    console.log(`     Amostras: ${issue.sampleIds.slice(0, 3).join(', ')}...`);
  }
}

async function check<T extends { id: string }>(
  label: string,
  query: () => Promise<T[]>,
  severity: AuditIssue['severity'],
  category: string,
): Promise<void> {
  totalChecks++;
  try {
    const results = await query();
    if (results.length > 0) {
      logIssue({
        severity,
        category,
        description: label,
        count: results.length,
        sampleIds: results.slice(0, 5).map((r) => r.id),
      });
    } else {
      console.log(`  ✓ ${label}`);
    }
  } catch (error) {
    console.warn(`  ⚠ Não foi possível verificar: ${label}`, error);
  }
}

async function runAudit(): Promise<void> {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes('--json');

  if (!jsonOutput) {
    console.log('\n🔍 Alusa — Auditoria de Integridade Multitenant');
    console.log('='.repeat(55));
    console.log('Verificando isolamento de dados entre tenants...\n');
  }

  // ─── Verificação 1: Usuários com contaId inválido ─────────────────────────
  console.log('\n📋 1. Verificação de Usuários');
  await check(
    'Usuários com contaId que não existe na tabela Conta',
    async () => {
      const users = await prisma.usuario.findMany({
        where: {
          contaId: {
            not: {
              in: (await prisma.conta.findMany({ select: { id: true } })).map((c) => c.id),
            },
          },
        },
        select: { id: true },
      });
      return users;
    },
    'CRITICAL',
    'Usuário',
  );

  // ─── Verificação 2: Alunos com contaId inválido ───────────────────────────
  console.log('\n📋 2. Verificação de Alunos');
  await check(
    'Alunos com contaId nulo ou inexistente',
    async () => {
      const contasIds = (await prisma.conta.findMany({ select: { id: true } })).map((c) => c.id);
      return prisma.aluno.findMany({
        where: { NOT: { contaId: { in: contasIds } } },
        select: { id: true },
      });
    },
    'CRITICAL',
    'Aluno',
  );

  // ─── Verificação 3: Matrículas cujo aluno pertence a outra conta ──────────
  console.log('\n📋 3. Verificação de Matrículas');
  const crossTenantMatriculas = await prisma.$queryRaw<{ id: string }[]>`
    SELECT m.id
    FROM "Matricula" m
    INNER JOIN "Aluno" a ON m."alunoId" = a.id
    INNER JOIN "Turma" t ON m."turmaId" = t.id
    WHERE a."contaId" != t."contaId"
    LIMIT 100
  `;

  if (crossTenantMatriculas.length > 0) {
    logIssue({
      severity: 'CRITICAL',
      category: 'Matrícula',
      description: 'Matrículas onde aluno e turma pertencem a contas diferentes (cross-tenant)',
      count: crossTenantMatriculas.length,
      sampleIds: crossTenantMatriculas.map((m) => m.id),
    });
  } else {
    console.log('  ✓ Matrículas: alunos e turmas pertencem ao mesmo tenant');
  }
  totalChecks++;

  // ─── Verificação 4: Cobranças com contaId indireto cruzado ───────────────
  console.log('\n📋 4. Verificação de Cobranças');
  const crossTenantCobrancas = await prisma.$queryRaw<{ id: string }[]>`
    SELECT c.id
    FROM "Cobranca" c
    INNER JOIN "Matricula" m ON c."matriculaId" = m.id
    INNER JOIN "Aluno" a ON m."alunoId" = a.id
    WHERE c."contaId" IS NOT NULL AND c."contaId" != a."contaId"
    LIMIT 100
  `;

  if (crossTenantCobrancas.length > 0) {
    logIssue({
      severity: 'CRITICAL',
      category: 'Cobrança',
      description: 'Cobranças onde contaId difere do contaId do aluno (cross-tenant)',
      count: crossTenantCobrancas.length,
      sampleIds: crossTenantCobrancas.map((c) => c.id),
    });
  } else {
    console.log('  ✓ Cobranças: alinhadas com o mesmo tenant');
  }
  totalChecks++;

  // ─── Verificação 5: Colaboradores com contaId inválido ────────────────────
  console.log('\n📋 5. Verificação de Colaboradores e Professores');
  await check(
    'Colaboradores com contaId inexistente na tabela Conta',
    async () => {
      const contasIds = (await prisma.conta.findMany({ select: { id: true } })).map((c) => c.id);
      return prisma.colaborador.findMany({
        where: { NOT: { contaId: { in: contasIds } } },
        select: { id: true },
      });
    },
    'HIGH',
    'Colaborador',
  );

  await check(
    'Professores com contaId inexistente na tabela Conta',
    async () => {
      const contasIds = (await prisma.conta.findMany({ select: { id: true } })).map((c) => c.id);
      return prisma.professor.findMany({
        where: { NOT: { contaId: { in: contasIds } } },
        select: { id: true },
      });
    },
    'HIGH',
    'Professor',
  );

  // ─── Verificação 6: Charges financeiros com contaId cruzado ──────────────
  console.log('\n📋 6. Verificação de Charges Financeiros');
  await check(
    'Charges sem contaId válido',
    async () => {
      const contasIds = (await prisma.conta.findMany({ select: { id: true } })).map((c) => c.id);
      return prisma.charge.findMany({
        where: { NOT: { contaId: { in: contasIds } } },
        select: { id: true },
      });
    },
    'HIGH',
    'Charge',
  );

  // ─── Verificação 7: Customers sem contaId válido ─────────────────────────
  await check(
    'Customers sem contaId válido',
    async () => {
      const contasIds = (await prisma.conta.findMany({ select: { id: true } })).map((c) => c.id);
      return prisma.customer.findMany({
        where: { NOT: { contaId: { in: contasIds } } },
        select: { id: true },
      });
    },
    'HIGH',
    'Customer',
  );

  // ─── Verificação 8: Sumário por tenant ────────────────────────────────────
  console.log('\n📋 7. Sumário de Registros por Tenant');
  try {
    const contas = await prisma.conta.findMany({
      select: {
        id: true,
        nome: true,
        status: true,
        _count: {
          select: {
            alunos: true,
            colaboradores: true,
            professores: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    console.log(`\n  ${'Conta'.padEnd(35)} ${'Alunos'.padStart(8)} ${'Colab.'.padStart(8)} ${'Prof.'.padStart(8)}`);
    console.log(`  ${'-'.repeat(65)}`);
    for (const conta of contas) {
      const nome = conta.nome.substring(0, 33).padEnd(35);
      console.log(
        `  ${nome} ${String(conta._count.alunos).padStart(8)} ${String(conta._count.colaboradores).padStart(8)} ${String(conta._count.professores).padStart(8)}`,
      );
    }
  } catch {
    console.warn('  ⚠ Não foi possível gerar sumário por tenant');
  }

  // ─── Relatório Final ──────────────────────────────────────────────────────
  const criticalCount = issues.filter((i) => i.severity === 'CRITICAL').length;
  const highCount = issues.filter((i) => i.severity === 'HIGH').length;
  const mediumCount = issues.filter((i) => i.severity === 'MEDIUM').length;
  const totalIssues = issues.length;

  console.log('\n' + '='.repeat(55));
  console.log('📊 RELATÓRIO FINAL DE AUDITORIA');
  console.log('='.repeat(55));
  console.log(`  Total de verificações executadas: ${totalChecks}`);
  console.log(`  Problemas encontrados: ${totalIssues}`);
  console.log(`    🔴 CRITICAL: ${criticalCount}`);
  console.log(`    🟠 HIGH:     ${highCount}`);
  console.log(`    🟡 MEDIUM:   ${mediumCount}`);

  if (totalIssues === 0) {
    console.log('\n  ✅ EXCELENTE! Nenhum problema de isolamento de tenant encontrado.');
    console.log('  O banco de dados está integro e sem registros cruzados entre contas.\n');
  } else {
    console.log('\n  ⚠️  AÇÃO RECOMENDADA: Revise os itens acima com a equipe de segurança.');
    console.log('  Para itens CRITICAL, corrija imediatamente antes do próximo deploy.\n');
  }

  if (jsonOutput) {
    console.log('\n' + JSON.stringify({ totalChecks, issues }, null, 2));
  }

  // Exit code não-zero se houver issues críticos (útil em pipelines CI/CD)
  if (criticalCount > 0) {
    process.exit(1);
  }
}

runAudit()
  .catch(async (e) => {
    console.error('Erro durante a auditoria:', e);
    await prisma.$disconnect();
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
