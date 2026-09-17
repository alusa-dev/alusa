import { prisma } from '@/lib/prisma';

/** Persistência concentrada para os fluxos de inscrição/eventos.
 * A autorização tenant-scoped continua sendo responsabilidade dos casos de uso.
 */
export const eventParticipantRepository = prisma;
