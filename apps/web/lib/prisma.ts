import { PrismaClient } from '@prisma/client';

// Singleton de Prisma para evitar múltiplas conexões no dev/hot-reload
// https://www.prisma.io/docs/guides/performance-and-optimization/connection-management
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function hasRequiredDelegates(client: PrismaClient | undefined): client is PrismaClient {
  if (!client) return false;
  return typeof (client as PrismaClient & { usuarioConta?: unknown }).usuarioConta === 'object';
}

export const prisma =
  hasRequiredDelegates(globalForPrisma.prisma) ? globalForPrisma.prisma :
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
