import { prisma } from '@/src/prisma';
import { pausarMatricula, reativarMatricula } from './enrollment-pause.service';
import { syncMatriculaStatus } from './enrollment-sync.service';

type InputOf<T> = T extends (..._args: infer Args) => unknown
  ? Args extends [infer Input, ...unknown[]]
    ? Input
    : never
  : never;

type HttpInput<T> = Omit<InputOf<T>, 'prisma'>;

export function pauseMatriculaFromHttp(input: HttpInput<typeof pausarMatricula>) {
  return pausarMatricula({ prisma, ...input });
}

export function reactivateMatriculaFromHttp(input: HttpInput<typeof reativarMatricula>) {
  return reativarMatricula({ prisma, ...input });
}

export function syncMatriculaStatusFromHttp(input: HttpInput<typeof syncMatriculaStatus>) {
  return syncMatriculaStatus({ prisma, ...input });
}

/** Resolve metadados do outbox para uma sincronização de cancelamento ainda em processamento. */
export async function resolveDeferredCancellationFromHttp(input: {
  contaId: string;
  matriculaId: string;
}) {
  const pendingEvent = await prisma.matriculaBillingOutbox.findFirst({
    where: {
      contaId: input.contaId,
      matriculaId: input.matriculaId,
      terminalIntent: 'CANCELADA',
      status: 'PROCESSING',
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, correlationId: true },
  });
  return {
    operationId: pendingEvent?.id ?? 'provisionamento-em-andamento',
    correlationId:
      pendingEvent?.correlationId ?? pendingEvent?.id ?? 'provisionamento-em-andamento',
  };
}

/** Resolve uma falha financeira retryable de cancelamento para a resposta HTTP pendente. */
export async function resolvePendingCancellationFromHttp(input: {
  contaId: string;
  matriculaId: string;
}) {
  const operation = await prisma.matriculaOperacao.findFirst({
    where: {
      contaId: input.contaId,
      matriculaId: input.matriculaId,
      tipo: 'CANCELAMENTO',
      status: 'DIVERGENTE',
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, correlationId: true, metadata: true },
  });
  const metadata = operation?.metadata;
  if (
    !operation ||
    !metadata ||
    typeof metadata !== 'object' ||
    !('retryable' in metadata) ||
    metadata.retryable !== true
  ) {
    return null;
  }

  const matricula = await prisma.matricula.findFirst({
    where: { id: input.matriculaId, contaId: input.contaId },
    select: { status: true },
  });
  return {
    operationId: operation.id,
    correlationId: operation.correlationId,
    status: matricula?.status ?? null,
  };
}
