import { prisma } from '@/src/prisma';
import { createRenewalCommunication, grantRenewalException } from './renewal-governance.service';

export async function createRenewalCommunicationForTenant(input: Parameters<typeof createRenewalCommunication>[0]) {
  if (!input.processoId) return null;
  const process = await prisma.rematriculaProcesso.findFirst({ where: { id: input.processoId, contaId: input.contaId }, select: { id: true, campanhaId: true } });
  if (!process) return null;
  return { process, communication: await createRenewalCommunication({ ...input, campanhaId: process.campanhaId }, { prisma }) };
}

export async function grantRenewalExceptionForTenant(input: Parameters<typeof grantRenewalException>[0]) {
  if (!input.processoId) return null;
  const process = await prisma.rematriculaProcesso.findFirst({ where: { id: input.processoId, contaId: input.contaId }, select: { id: true, campanhaId: true } });
  if (!process) return null;
  return { process, exception: await grantRenewalException({ ...input, campanhaId: process.campanhaId }, { prisma }) };
}
