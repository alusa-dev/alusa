import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  return new PrismaClient({
    log: ['query', 'info', 'warn', 'error'],
  });
}

function hasRequiredDelegates(client: PrismaClient | undefined): client is PrismaClient {
  if (!client) return false;
  return (
    typeof (client as PrismaClient & Record<string, unknown>).usuarioConta === 'object' &&
    typeof (client as PrismaClient & Record<string, unknown>).calendarEvent === 'object' &&
    typeof (client as PrismaClient & Record<string, { findMany?: unknown }>).calendarEvent?.findMany ===
      'function' &&
    typeof (client as PrismaClient & Record<string, { findMany?: unknown }>).attendanceRecord?.findMany ===
      'function' &&
    typeof (client as PrismaClient & Record<string, { findMany?: unknown }>).makeupClass?.findMany ===
      'function' &&
    typeof (client as PrismaClient & Record<string, { findMany?: unknown }>).aulasOperationLog?.findMany ===
      'function'
  );
}

export const prisma =
  hasRequiredDelegates(globalForPrisma.prisma) ? globalForPrisma.prisma : createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
