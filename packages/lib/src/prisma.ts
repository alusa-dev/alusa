import { PrismaClient } from '@prisma/client';

// Evita múltiplas conexões em ambiente de desenvolvimento quando hot-reload
// Em pacotes compartilhados não podemos confiar em variáveis globais do app Next,
// então utilizamos (globalThis as any) com um nome isolado.
declare global {
  // eslint-disable-next-line no-var
  var __alusa_prisma__: PrismaClient | undefined; // NOSONAR
}

let _prisma = globalThis.__alusa_prisma__ as PrismaClient | undefined;

function hasRequiredDelegates(client: PrismaClient | undefined): client is PrismaClient {
  if (!client) return false;
  return typeof (client as PrismaClient & { usuarioConta?: unknown }).usuarioConta === 'object';
}

function getClient(): PrismaClient {
  if (!hasRequiredDelegates(_prisma)) {
    const stalePrisma = _prisma as PrismaClient | undefined;
    if (stalePrisma) void stalePrisma.$disconnect();
    _prisma = new PrismaClient();
    if (process.env.NODE_ENV !== 'production') {
      globalThis.__alusa_prisma__ = _prisma;
    }
  }
  return _prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getClient() as unknown as Record<string | symbol, unknown>;
    return Reflect.get(client, prop, receiver);
  },
  set(_target, prop, value, receiver) {
    const client = getClient() as unknown as Record<string | symbol, unknown>;
    return Reflect.set(client, prop, value, receiver);
  },
});

export type { Prisma } from '@prisma/client';
