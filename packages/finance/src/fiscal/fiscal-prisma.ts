import { Prisma, PrismaClient } from '@prisma/client';

type FiscalPrismaClient = PrismaClient;

const globalForFiscalPrisma = globalThis as unknown as {
  fiscalPrismaClient?: PrismaClient;
  fiscalPrismaSchemaFingerprint?: string;
};

export function contaFiscalSettingsSchemaFingerprint(): string {
  return Object.keys(Prisma.ContaFiscalSettingsScalarFieldEnum).sort().join(',');
}

function createFiscalPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
}

/**
 * Client dedicado ao domínio fiscal.
 *
 * Não reutiliza o singleton global de `@alusa/database`: após `prisma generate`
 * o processo do Next.js pode manter uma instância antiga em `globalThis.prisma`
 * que não reconhece campos novos de `ContaFiscalSettings` (ex.: stateInscription).
 */
export function getFiscalPrisma(): FiscalPrismaClient {
  const fingerprint = contaFiscalSettingsSchemaFingerprint();

  if (
    !globalForFiscalPrisma.fiscalPrismaClient ||
    globalForFiscalPrisma.fiscalPrismaSchemaFingerprint !== fingerprint
  ) {
    if (globalForFiscalPrisma.fiscalPrismaClient) {
      void globalForFiscalPrisma.fiscalPrismaClient.$disconnect();
    }

    globalForFiscalPrisma.fiscalPrismaClient = createFiscalPrismaClient();
    globalForFiscalPrisma.fiscalPrismaSchemaFingerprint = fingerprint;
  }

  return globalForFiscalPrisma.fiscalPrismaClient;
}
