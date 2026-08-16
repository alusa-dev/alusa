import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  return new PrismaClient({
    log: ['query', 'info', 'warn', 'error'],
  });
}

function hasEventContractRelation(client: PrismaClient): boolean {
  const runtimeDataModel = (client as PrismaClient & {
    _runtimeDataModel?: {
      models?: Record<string, { fields?: Array<{ name: string }> }>;
    };
  })._runtimeDataModel;

  return runtimeDataModel?.models?.Aluno?.fields?.some(
    (field) => field.name === 'contratosEvento',
  ) === true;
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
      'function' &&
    typeof (client as PrismaClient & Record<string, unknown>).contratoModeloCampo === 'object' &&
    // O client antigo, mantido pelo hot-reload, não conhece os contratos de eventos.
    // Recriá-lo aqui evita que o Next/Turbopack use um DMMF anterior ao schema atual.
    typeof (client as PrismaClient & Record<string, unknown>).eventoContrato === 'object' &&
    hasEventContractRelation(client)
  );
}

export const prisma =
  hasRequiredDelegates(globalForPrisma.prisma) ? globalForPrisma.prisma : createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
