import { PrismaClient } from '@prisma/client';

// Singleton seguro para Next.js (App Router / ESM) usando globalThis
const globalForPrisma = globalThis;

function createPrismaClient() {
    return new PrismaClient({
        log: ['query', 'info', 'warn', 'error'],
    });
}

function hasRequiredDelegates(client) {
    if (!client) return false;
    return (
        typeof client.usuarioConta === 'object' &&
        typeof client.calendarEvent?.findMany === 'function' &&
        typeof client.attendanceRecord?.findMany === 'function' &&
        typeof client.makeupClass?.findMany === 'function' &&
        typeof client.aulasOperationLog?.findMany === 'function'
    );
}

if (!hasRequiredDelegates(globalForPrisma.__prisma)) {
    globalForPrisma.__prisma = createPrismaClient();
}

export const prisma = globalForPrisma.__prisma;
