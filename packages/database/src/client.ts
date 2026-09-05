import { Prisma, PrismaClient } from '@prisma/client';

import { assertSafeDatabaseEnv } from './safe-db.js';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaSchemaVersion: string | undefined;
};

const REQUIRED_MODEL_DELEGATES = [
  'contaFiscalSettings',
  'fiscalService',
  'invoice',
  'invoiceAuditEvent',
  'eventBillingGroup',
] as const;

function modelDelegateName(modelName: string): string {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

function computeSchemaVersion(): string {
  try {
    const models = Prisma.dmmf?.datamodel?.models ?? [];
    const modelCount = models.length;
    const fieldCount = models.reduce(
      (acc: number, m: { fields: readonly unknown[] }) => acc + m.fields.length,
      0,
    );
    const fieldSignature = models
      .map((model) => {
        const fields = model.fields as ReadonlyArray<{ name: string }>;
        return `${model.name}:${fields
          .map((field) => field.name)
          .sort()
          .join('.')}`;
      })
      .sort()
      .join('|');
    return `${modelCount}:${fieldCount}:${fieldSignature}`;
  } catch {
    return 'unknown';
  }
}

function isPrismaClientStale(client: PrismaClient | undefined): boolean {
  if (!client) return false;

  try {
    if (REQUIRED_MODEL_DELEGATES.some((delegate) => !(delegate in client))) {
      return true;
    }

    const models = Prisma.dmmf?.datamodel?.models ?? [];
    return models.some((model) => !(modelDelegateName(model.name) in client));
  } catch {
    return false;
  }
}

function discardPrismaSingleton(): void {
  if (globalForPrisma.prisma) {
    void globalForPrisma.prisma.$disconnect();
    globalForPrisma.prisma = undefined;
  }
}

// Schema version derived from the Prisma DMMF to detect stale singletons.
// When prisma generate runs, the DMMF changes; a fresh client is required even
// if globalThis.prisma survived a hot-reload.
const SCHEMA_VERSION = computeSchemaVersion();

if (
  globalForPrisma.prismaSchemaVersion !== SCHEMA_VERSION ||
  isPrismaClientStale(globalForPrisma.prisma)
) {
  discardPrismaSingleton();
  globalForPrisma.prismaSchemaVersion = SCHEMA_VERSION;
}

if (process.env.NODE_ENV !== 'production') {
  assertSafeDatabaseEnv(process.env.NODE_ENV === 'test' ? 'test' : 'dev');
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
