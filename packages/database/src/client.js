import { PrismaClient } from '@prisma/client';
/**
 * Singleton do Prisma Client
 * Evita múltiplas instâncias em desenvolvimento (hot reload)
 */
const globalForPrisma = globalThis;
export const prisma = globalForPrisma.prisma ??
    new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}
