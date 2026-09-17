import { prisma } from '@/src/prisma';

/** Gateway de persistência dos handlers legados de matrícula durante a migração.
 * Cada chamada permanece tenant-scoped no caso de uso/handler que a invoca.
 */
export const matriculaRouteRepository = prisma;
