/**
 * @file prisma-tenant.ts
 * @description Prisma Client Extension para isolamento automático de tenant (multi-tenancy).
 *
 * Esta extensão intercepta as operações do Prisma e injeta automaticamente
 * o `contaId` do tenant ativo nas cláusulas `where` de todos os modelos
 * tenant-aware (aqueles que possuem a coluna `contaId`).
 *
 * Isso elimina o risco de vazamento de dados cross-tenant causado por
 * ausência acidental do filtro em uma consulta.
 *
 * Uso:
 *   import { createTenantPrismaClient } from '@/lib/prisma-tenant';
 *   const db = createTenantPrismaClient(contaId);
 *
 * IMPORTANTE: Use este cliente apenas em contextos onde o `contaId` está
 * disponível (server actions, route handlers autenticados). Para operações
 * administrativas globais (webhooks, jobs), continue usando o `prisma` padrão
 * com os filtros explícitos adequados.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

// ─── Lista canônica de modelos com isolamento por contaId ─────────────────────
// Fonte: schema.prisma — todos os modelos com `contaId String` direto.
// Atualize esta lista sempre que adicionar um novo modelo tenant-aware ao schema.
export const TENANT_AWARE_MODELS = [
  'colaborador',
  'professor',
  'aluno',
  'turma',
  'modalidade',
  'sala',
  'plano',
  'combo',
  'desconto',
  'matricula',
  'cobranca',
  'lancamento',
  'centroCusto',
  'categoriaLancamento',
  'calendarEvent',
  'attendanceRecord',
  'makeupClass',
  'aulasOperationLog',
  'portalEvento',
  'contratoTemplate',
  'contratoModelo',
  'notificacao',
  'notification',
  'notificationRecipient',
  'auditLog',
  'financeProfile',
  'customer',
  'charge',
  'chargeReadModel',
  'standaloneInstallmentPlan',
  'standaloneSubscription',
  'invoice',
  'subscription',
  'installmentPlan',
  'transferRequest',
  'pixTransferSession',
  'tenantFeatureFlags',
  'productCategory',
  'product',
  'sale',
  'inventoryBalance',
  'inventoryMovement',
  'restockOrder',
  'webhookAsaas',
  'webhookAsaasArchive',
  'logFinanceiro',
  'logIntegracao',
  'asaasIntegrationJob',
  'asaasNotificationPreference',
  'contaFinancialPolicy',
  'rematriculaOperacao',
  'payerChangeOperacao',
  'matriculaOperacao',
] as const;

export type TenantAwareModel = (typeof TENANT_AWARE_MODELS)[number];

// Helper para verificar se um modelo é tenant-aware
function isTenantAwareModel(model: string | undefined): boolean {
  if (!model) return false;
  const normalized = model.charAt(0).toLowerCase() + model.slice(1);
  return (TENANT_AWARE_MODELS as readonly string[]).includes(normalized);
}

/**
 * Cria uma instância do Prisma Client com extensão de isolamento de tenant.
 *
 * A extensão intercepta as operações de query (findMany, findFirst, findUnique,
 * update, updateMany, delete, deleteMany, count, aggregate) e injeta
 * automaticamente `{ contaId }` na cláusula `where`, garantindo que os dados
 * de um tenant nunca sejam acessados por outro.
 *
 * @param contaId - O ID da conta (tenant) ativa. Obtido da sessão do usuário.
 * @returns Uma instância do PrismaClient com isolamento de tenant ativo.
 */
export function createTenantPrismaClient(contaId: string) {
  if (!contaId || typeof contaId !== 'string') {
    throw new Error(
      '[TenantPrisma] contaId inválido. Não é possível criar um cliente de tenant sem um ID de conta válido.',
    );
  }

  return prisma.$extends({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({
          model,
          operation,
          args,
          query,
        }: {
          model: string | undefined;
          operation: string;
          args: Record<string, unknown>;
          query: (args: Record<string, unknown>) => Promise<unknown>;
        }) {
          // Operações de escrita e leitura que suportam `where`
          const operationsWithWhere = [
            'findMany',
            'findFirst',
            'findFirstOrThrow',
            'findUnique',
            'findUniqueOrThrow',
            'update',
            'updateMany',
            'delete',
            'deleteMany',
            'count',
            'aggregate',
            'groupBy',
          ];

          if (isTenantAwareModel(model) && operationsWithWhere.includes(operation)) {
            const modifiedArgs = {
              ...args,
              where: {
                ...(typeof args.where === 'object' && args.where !== null ? args.where : {}),
                contaId,
              },
            };

            return query(modifiedArgs);
          }

          return query(args);
        },
      },
    },
  });
}

/**
 * Tipo utilitário para o cliente Prisma com isolamento de tenant.
 * Útil para tipar parâmetros de funções que recebem o cliente.
 */
export type TenantPrismaClient = ReturnType<typeof createTenantPrismaClient>;

/**
 * Helper para extrair o contaId da sessão e criar o cliente de tenant.
 * Lança um erro se o contaId não estiver disponível na sessão.
 *
 * @param session - A sessão do usuário (NextAuth Session).
 * @returns Uma instância do PrismaClient com isolamento de tenant ativo.
 */
export function createTenantPrismaFromSession(
  session: { user?: { contaId?: string | null } } | null,
): TenantPrismaClient {
  const contaId = session?.user?.contaId;
  if (!contaId) {
    throw new Error('[TenantPrisma] Sessão inválida ou sem contaId. Acesso negado.');
  }
  return createTenantPrismaClient(contaId);
}
