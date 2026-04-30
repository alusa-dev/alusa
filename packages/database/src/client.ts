import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaSchemaVersion: string | undefined;
};

// Schema version derived from the Prisma DMMF hash to detect stale singletons.
// When prisma generate runs, the DMMF changes; the new process will get a fresh
// client even if globalThis.prisma survived a hot-reload.
const SCHEMA_VERSION = (() => {
  try {
    const { Prisma } = require('@prisma/client');
    const models = Prisma.dmmf?.datamodel?.models ?? [];
    const fieldCount = models.reduce((acc: number, m: { fields: unknown[] }) => acc + m.fields.length, 0);
    return String(fieldCount);
  } catch {
    return 'unknown';
  }
})();

if (globalForPrisma.prismaSchemaVersion !== SCHEMA_VERSION) {
  // Schema changed (prisma generate was run) — discard stale singleton.
  if (globalForPrisma.prisma) {
    void globalForPrisma.prisma.$disconnect();
    globalForPrisma.prisma = undefined;
  }
  globalForPrisma.prismaSchemaVersion = SCHEMA_VERSION;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
