/**
 * @file tenant.ts
 * @description Barrel de exportações para o sistema de isolamento multitenant Alusa.
 *
 * Importação centralizada para os utilitários de tenant:
 *
 * @example
 * // Em route handlers e server actions:
 * import { createTenantPrismaClient, createTenantPrismaFromSession } from '@/lib/tenant';
 *
 * export async function GET() {
 *   const session = await getServerSession(authOptions);
 *   const db = createTenantPrismaFromSession(session);
 *   const alunos = await db.aluno.findMany(); // contaId injetado automaticamente
 * }
 */

// Prisma Extension — Fase 1: Isolamento no ORM
export {
  createTenantPrismaClient,
  createTenantPrismaFromSession,
  TENANT_AWARE_MODELS,
} from '@/lib/prisma-tenant';

export type {
  TenantPrismaClient,
  TenantAwareModel,
} from '@/lib/prisma-tenant';

// RLS Helpers — Fase 2: Ativação do Row-Level Security do PostgreSQL
export {
  createRlsTenantClient,
  setTenantSession,
  clearTenantSession,
  withTenantContext,
} from '@/lib/prisma-rls';
