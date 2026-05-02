/**
 * @file prisma-rls.ts
 * @description Utilitários para configurar Row-Level Security (RLS) no PostgreSQL
 * via variável de sessão `app.current_tenant`.
 *
 * Este módulo complementa o `prisma-tenant.ts` (Fase 1) fornecendo a camada
 * de ativação do RLS no banco. Deve ser usado quando o RLS está habilitado
 * via `scripts/setup-rls.ts`.
 *
 * Uso:
 *   import { withTenantContext } from '@/lib/prisma-rls';
 *   const result = await withTenantContext(contaId, () => prisma.aluno.findMany());
 */

import { PrismaClient } from '@prisma/client';
import prisma from '@/lib/prisma';

// Instância tipada corretamente para uso dos métodos raw
const rawPrisma = prisma as unknown as PrismaClient;

/**
 * Ativa a sessão de tenant no PostgreSQL para o contaId fornecido.
 * Isso permite que o Row-Level Security (RLS) filtre automaticamente
 * os dados retornados pelas queries subsequentes na mesma conexão.
 *
 * @param contaId - ID da conta (tenant) ativa
 */
export async function setTenantSession(contaId: string): Promise<void> {
  if (!contaId) return;
  await rawPrisma.$executeRaw`SELECT set_config('app.current_tenant', ${contaId}, TRUE)`;
}

/**
 * Limpa a variável de sessão do tenant ao final de uma operação.
 * Boa prática para garantir que a sessão não vaze entre requisições.
 */
export async function clearTenantSession(): Promise<void> {
  await rawPrisma.$executeRaw`SELECT set_config('app.current_tenant', '', TRUE)`;
}

/**
 * Executa um bloco de código com o contexto de tenant definido no PostgreSQL.
 * Garante que o tenant seja limpo mesmo em caso de erro.
 *
 * Use este helper quando o RLS estiver habilitado no banco (via setup-rls.ts)
 * para garantir que as queries respeitem a política de isolamento.
 *
 * @example
 * const alunos = await withTenantContext(contaId, async () => {
 *   return prisma.aluno.findMany();
 * });
 */
export async function withTenantContext<T>(
  contaId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await setTenantSession(contaId);
  try {
    return await fn();
  } finally {
    await clearTenantSession();
  }
}

/**
 * Cria um cliente Prisma com a sessão de tenant configurada antes de cada query.
 *
 * Nota: Esta implementação usa $extends e executa SET antes de cada operação
 * via um wrapper. Para maior segurança, use `withTenantContext` em conjunto
 * com `createTenantPrismaClient` da Fase 1.
 *
 * @param contaId - ID da conta (tenant) ativa
 */
export function createRlsTenantClient(contaId: string) {
  if (!contaId || typeof contaId !== 'string') {
    throw new Error('[RlsTenantPrisma] contaId inválido. Acesso negado.');
  }

  return rawPrisma.$extends({
    name: 'rls-tenant-session',
    query: {
      $allModels: {
        async $allOperations({
          args,
          query,
        }: {
          model: string | undefined;
          operation: string;
          args: Record<string, unknown>;
          query: (args: Record<string, unknown>) => Promise<unknown>;
        }) {
          // Define a variável de sessão do Postgres para ativar o RLS
          await rawPrisma.$executeRaw`SELECT set_config('app.current_tenant', ${contaId}, TRUE)`;
          return query(args);
        },
      },
    },
  });
}
