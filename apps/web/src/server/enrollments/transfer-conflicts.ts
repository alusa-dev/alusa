import { Prisma } from '@prisma/client';

const transferOriginConstraintNames = new Set([
  'TransferenciaAcademicaVinculo_origemVinculoId_key',
  'uq_transferencia_academica_origem',
  'TransferenciaAcademicaVinculo_contaId_origemVinculoId_key',
]);

export function isTransferOriginUniqueConflict(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  if (Array.isArray(target)) return target.includes('origemVinculoId');
  return typeof target === 'string' && transferOriginConstraintNames.has(target);
}

const transferRelationConstraintNames = new Set([
  ...transferOriginConstraintNames,
  'TransferenciaAcademicaVinculo_destinoVinculoId_key',
  'uq_transferencia_academica_destino',
  'TransferenciaAcademicaVinculo_contaId_destinoVinculoId_key',
]);

export function isTransferRelationUniqueConflict(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  if (Array.isArray(target)) return target.some((field) => field === 'origemVinculoId' || field === 'destinoVinculoId');
  return typeof target === 'string' && transferRelationConstraintNames.has(target);
}
